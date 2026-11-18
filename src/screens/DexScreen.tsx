import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { t } from '../i18n';
import { useData, useProviders } from '../data/providers/context';
import type { Candle, CandleInterval } from '../data/providers';
import type { OrderData } from '../trade/orders';
import { COIN_REF, orderPhase, proportionalGivePayout } from '../trade/orders';
import { checkAmounts, checkSlippage } from '../trade/priceGuards';
import { isBindingsUnavailable } from '../send/errors';
import { ML_DECIMALS, atomsToDecimal, decimalsToAtoms } from '../money';
import { C, G, alpha, black } from '../theme';
import { Btn, Candles, Card, Chip, Enter, Field, IconBtn, KVRow, Label, LivePill, PctButtons, Screen, Segmented, Sheet, Txt, tile, usd } from '../ui';

/** How long a fetched book stays fresh before the stale banner shows. */
const BOOK_STALE_MS = 90_000;
const BOOK_POLL_MS = 30_000;
/** Slippage band for the ticket (guard rejects beyond it). */
const MAX_SLIPPAGE_PCT = 1;

export function DexScreen() {
  // Loaded wrapper: useData answers null while pending AND for a null
  // result, so the header unavailable state needs the resolved marker.
  const marketState = useData(async (d) => ({ market: await d.getMarket('ML/USDT') }));
  const market = marketState?.market ?? null;
  const timeframes = useData((d) => d.getTimeframes());
  const fees = useData((d) => d.getFees());
  const assets = useData((d) => d.getAssets());
  const askTokenIds = useData((d) => d.getTokenIds('USDT'));
  const askMeta = useData((d) => d.getTokenMeta('USDT'));
  const { price, orderBook: bookService, orders, mode, pricesAreMock } = useProviders();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [book, setBook] = useState<'book' | 'trades' | 'depth'>('book');
  const [orderType, setOrderType] = useState<'Limit' | 'Market' | 'Stop'>('Limit');
  const [tf, setTf] = useState<CandleInterval>('1h');
  const [amount, setAmount] = useState('250');
  const [candles, setCandles] = useState<Candle[] | null>(null);

  // Live book (spec M4): aggregated levels from the order book service with
  // a poll cycle, a stale banner and typed error states. Mock mode serves
  // the same rows from fixtures, so the screen never branches on the mode.
  const [liveBook, setLiveBook] = useState<{ asks: { price: string; size: string; total: string }[]; bids: { price: string; size: string; total: string }[] } | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);
  const [bookLoadedAt, setBookLoadedAt] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const [asks, bids] = await Promise.all([
          bookService.levels('ML', 'USDT', 'ask'),
          bookService.levels('ML', 'USDT', 'bid'),
        ]);
        if (!live) return;
        setLiveBook({ asks, bids });
        setBookError(null);
        setBookLoadedAt(Date.now());
      } catch (e) {
        if (!live) return;
        // A stale cursor page recovers internally (page-1 restart); a 400
        // that still surfaces names the cursor, anything else the book.
        const record = e as { status?: number } | null;
        setBookError(record?.status === 400 ? t('errors.orders.invalidCursor') : t('dex.book.error'));
        setBookLoadedAt(Date.now());
      }
    };
    void load();
    const timer = setInterval(load, BOOK_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [bookService, refreshKey]);

  useEffect(() => {
    let live = true;
    price.getCandles('ML/USDT', tf).then((rows) => {
      if (live) setCandles(rows);
    });
    return () => {
      live = false;
    };
  }, [price, tf]);

  // My orders (spec: actions on orders flagged as mine). myOrders spans
  // every wallet pair; this screen trades ML/USDT, so rows are filtered to
  // the displayed pair (either direction) instead of rendering foreign
  // tickers with hardcoded decimals. An ambiguous USDT ticker (more than
  // one token id) keeps the list unloaded: the ticket refuses placement on
  // the same condition.
  const [myOrders, setMyOrders] = useState<OrderData[] | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const usdtTokenId = askTokenIds !== null && askTokenIds.length === 1 ? askTokenIds[0] : null;
  const loadMyOrders = useCallback(async () => {
    if (usdtTokenId === null) return;
    try {
      const mine = await orders.myOrders();
      setMyOrders(
        mine.filter(
          (order) =>
            (order.giveTokenId === COIN_REF && order.askTokenId === usdtTokenId) ||
            (order.giveTokenId === usdtTokenId && order.askTokenId === COIN_REF),
        ),
      );
      setOrdersError(null);
    } catch {
      setOrdersError(t('errors.orders.book'));
    }
  }, [orders, usdtTokenId]);
  useEffect(() => {
    void loadMyOrders();
  }, [loadMyOrders]);

  // Place-order sheet state.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [lastDemoNote, setLastDemoNote] = useState<string | null>(null);
  // Fill confirmation state: the payout preview (proportionalGivePayout on
  // the order legs) plus the effective price versus the book mid, before
  // any fill transaction is built. legs carries the direction-derived
  // decimals and symbols (the fill pays the order's ask currency).
  const [fillSheet, setFillSheet] = useState<{
    order: OrderData;
    payout: string;
    effective: string;
    mid: string;
    legs: { payDecimals: number; paySymbol: string; receiveDecimals: number; receiveSymbol: string };
  } | null>(null);

  const bookRows = liveBook;
  if (!timeframes || !fees || !candles || !assets || !askTokenIds || !askMeta || !bookRows) return <Screen />;
  const maxAsk = Math.max(...bookRows.asks.map((r) => Number(r.total || 0)), 1);
  const maxBid = Math.max(...bookRows.bids.map((r) => Number(r.total || 0)), 1);
  // Quote-token decimals with the absent-meta fallback: 0 is a valid
  // precision, so a falsy-decimals fallback would inflate a 0-decimal
  // order leg by 1e11.
  const askDecimals = Number.isInteger(askMeta.decimals) ? askMeta.decimals : ML_DECIMALS;
  const total = usd(amount, market?.price ?? 0);
  const bestAsk = Number(bookRows.asks[0]?.price ?? market?.price ?? 0);
  const bestBid = Number(bookRows.bids[0]?.price ?? market?.price ?? 0);
  const spread = Math.abs(bestAsk - bestBid);
  const spreadPct = (spread / bestAsk) * 100;
  const mlBalance = assets.find((a) => a.sym === 'ML')?.amt ?? 0;
  const bookIsStale = bookLoadedAt > 0 && Date.now() - bookLoadedAt > BOOK_STALE_MS;

  /** Ticket submit: the give/ask legs follow the selected side (buy: the
   *  USDT token is given and ML is asked; sell: the inverse), guards run
   *  first, and the order flows run last. Real mode runs the full pipeline
   *  (device-pending and config-pending states surface honestly); mock
   *  mode runs the demo pipeline labelled as demo. */
  const placeOrder = async () => {
    setTicketError(null);
    if (market === null) {
      setTicketError(t('errors.price.unavailable'));
      return;
    }
    if (orderType !== 'Limit') {
      setTicketError(t('dex.order.typeUnsupported'));
      return;
    }
    const buy = side === 'buy';
    const guard = checkAmounts({ giveDecimal: buy ? total : amount, askDecimal: buy ? amount : total });
    if (!guard.ok) {
      setTicketError(t('dex.order.badAmount'));
      return;
    }
    // Slippage guard versus the live book mid (the ticket prices at the
    // header snapshot, so the drift check runs before anything is built).
    const mid = (bestAsk + bestBid) / 2;
    if (mid > 0) {
      const slippage = checkSlippage({ limitDecimal: market.price.toFixed(6), midDecimal: mid.toFixed(6), maxSlippagePct: MAX_SLIPPAGE_PCT });
      if (!slippage.ok) {
        setTicketError(t('dex.fill.slippageWarn', { drift: ((Math.abs(market.price - mid) / mid) * 100).toFixed(2) }));
        return;
      }
    }
    // Tickers are not unique (F6): placement refuses instead of guessing
    // which token id the user meant.
    if (askTokenIds.length !== 1) {
      setTicketError(t('dex.order.ambiguousTicker'));
      return;
    }
    setPlacing(true);
    try {
      await orders.createOrder({
        giveTokenId: buy ? askTokenIds[0] : COIN_REF,
        giveAtoms: buy ? decimalsToAtoms(total, askDecimals) : decimalsToAtoms(amount, ML_DECIMALS),
        askTokenId: buy ? COIN_REF : askTokenIds[0],
        askAtoms: buy ? decimalsToAtoms(amount, ML_DECIMALS) : decimalsToAtoms(total, askDecimals),
      });
      setConfirmOpen(false);
      setLastDemoNote(mode === 'mock' ? t('dex.order.demo') : null);
      void loadMyOrders();
    } catch (e) {
      setConfirmOpen(false);
      setTicketError(orderErrorCopy(e));
    } finally {
      setPlacing(false);
    }
  };

  /** Fill preview: payout from the order legs (the same math the flow
   *  applies) and the effective ask-per-give price, checked against the
   *  book mid before the fill executes; the flow re-checks the band. The
   *  legs follow the order's direction, not the ticket's. */
  const openFill = (order: OrderData) => {
    const legs = pairLegs(order, askDecimals);
    const mid = (bestAsk + bestBid) / 2;
    const payout = proportionalGivePayout(order.giveBalanceAtoms, order.askBalanceAtoms, order.askBalanceAtoms);
    const fillDecimal = Number(atomsToDecimal(order.askBalanceAtoms, legs.payDecimals));
    const payoutDecimal = Number(atomsToDecimal(payout, legs.receiveDecimals));
    const effective = payoutDecimal > 0 ? fillDecimal / payoutDecimal : 0;
    setFillSheet({ order, payout, effective: effective.toFixed(4), mid: mid.toFixed(4), legs });
  };

  const runFill = async () => {
    if (!fillSheet) return;
    setPlacing(true);
    try {
      await orders.fillOrder({
        orderId: fillSheet.order.orderId,
        fillAtoms: fillSheet.order.askBalanceAtoms,
        destination: fillSheet.order.concludeDestination,
        priceBand: { midDecimal: fillSheet.mid, maxSlippagePct: MAX_SLIPPAGE_PCT, askDecimals: fillSheet.legs.payDecimals, giveDecimals: fillSheet.legs.receiveDecimals },
      });
      setFillSheet(null);
      void loadMyOrders();
    } catch (e) {
      setFillSheet(null);
      setTicketError(orderErrorCopy(e));
    } finally {
      setPlacing(false);
    }
  };

  return (
    <Screen>
      <View className="px-5 flex-row items-center justify-between">
        <View>
          <View className="flex-row items-center gap-2">
            <Txt className="text-[18px] font-bold">{'ML/USDT'}</Txt>
            <Chip tone={C.teal} dot={false}>
              {t('dex.badge')}
            </Chip>
          </View>
          <Txt mono className="text-[11px] text-text2 mt-0.5">
            {market?.volume ?? ''}
          </Txt>
        </View>
        <IconBtn name="chart" label={t('dex.fullChart')} />
      </View>

      {/* Price + candles */}
      <View className="px-5 pt-5">
        <Card grad={G.raisedTeal} className="p-4">
          {market === null ? (
            <Txt className="text-[12px] text-text2">{t('errors.price.unavailable')}</Txt>
          ) : (
          <View className="flex-row justify-between items-end">
            <View>
              <Label>{t('dex.lastPrice')}</Label>
              <View className="flex-row items-baseline gap-2 mt-0.5">
                <Txt mono className="text-[28px] font-bold">
                  ${market.last}
                </Txt>
                <LivePill value={market.change} />
              </View>
              {market.btc.length > 0 && (
                <Txt mono className="text-[11px] text-text2 mt-0.5">
                  {market.btc}
                </Txt>
              )}
            </View>
            <View className="items-end">
              <Txt className="text-[10px] text-text3">{t('dex.high24h')}</Txt>
              <Txt mono className="text-[12px]" style={{ color: C.green }}>
                {market.high}
              </Txt>
              <Txt className="text-[10px] text-text3 mt-1">{t('dex.low24h')}</Txt>
              <Txt mono className="text-[12px]" style={{ color: C.red }}>
                {market.low}
              </Txt>
            </View>
          </View>
          )}

          <View className="mt-3">
            <Candles candles={candles} />
          </View>
          <Segmented options={timeframes} value={tf} onChange={setTf} variant="ghost" accent={C.teal} className="mt-2" />
          {pricesAreMock && (
            <Txt className="text-[10px] text-text3 mt-2">{t('dex.priceIndicative')}</Txt>
          )}
        </Card>
      </View>

      <View className="px-5 pt-4">
        <Segmented
          options={['book', 'trades', 'depth'] as const}
          value={book}
          onChange={setBook}
          variant="tabs"
          labels={{ book: t('dex.book'), trades: t('dex.trades'), depth: t('dex.depth') }}
        />
      </View>

      {/* Order book: live levels, honest stale and error states. */}
      <View className="pt-3">
        {bookError && (
          <View className="mx-4 mb-2">
            <Txt className="text-[11px]" style={{ color: C.red }}>
              {bookError}
            </Txt>
          </View>
        )}
        {bookIsStale && !bookError && (
          <Pressable accessibilityRole="button" onPress={() => setRefreshKey((k) => k + 1)} className="mx-4 mb-2">
            <Txt className="text-[11px]" style={{ color: C.amber }}>
              {t('dex.book.stale')}
            </Txt>
          </Pressable>
        )}
        <View className="flex-row px-4 py-1">
          <Txt className="flex-1 text-[10px] text-text3 tracking-label">{t('dex.col.price')}</Txt>
          <Txt className="flex-1 text-[10px] text-text3 tracking-label text-center">{t('dex.col.size')}</Txt>
          <Txt className="flex-1 text-[10px] text-text3 tracking-label text-right">{t('dex.col.total')}</Txt>
        </View>

        {bookRows.asks.map((r, i) => (
          <BookRow key={`a${i}`} row={r} max={maxAsk} tone={C.red} delay={i * 30} />
        ))}

        <View
          className="mx-4 my-2 px-3 py-2 rounded-[10px] flex-row justify-between items-center"
          style={tile()}>
          <Txt mono className="text-[12px] text-text2">
            {t('dex.spread')}
          </Txt>
          <Txt mono className="text-[12px] font-semibold">
            {`${spread.toFixed(4)} · ${spreadPct.toFixed(2)}%`}
          </Txt>
          <Txt mono className="text-[12px]" style={{ color: C.teal }}>
            ↕
          </Txt>
        </View>

        {bookRows.bids.map((r, i) => (
          <BookRow key={`b${i}`} row={r} max={maxBid} tone={C.green} delay={200 + i * 30} />
        ))}
      </View>

      {/* Order ticket */}
      <View className="px-5 pt-5">
        <Card className="p-4">
          <View className="flex-row gap-1 p-[3px] rounded-[10px] mb-3.5" style={{ backgroundColor: black(0.3) }}>
            {(['buy', 'sell'] as const).map((s) => {
              const on = side === s;
              const c = s === 'buy' ? C.green : C.red;
              return (
                <Pressable
                  key={s}
                  onPress={() => setSide(s)}
                  className="flex-1 py-2 rounded-lg items-center"
                  style={{
                    backgroundColor: on ? alpha(c, 0.18) : 'transparent',
                    borderWidth: 1,
                    borderColor: on ? alpha(c, 0.4) : 'transparent',
                  }}>
                  <Txt className="text-[13px] font-semibold capitalize" style={{ color: on ? c : C.text2 }}>
                    {t(s === 'buy' ? 'dex.buy' : 'dex.sell')}
                  </Txt>
                </Pressable>
              );
            })}
          </View>

          <Segmented
            options={['Limit', 'Market', 'Stop'] as const}
            value={orderType}
            onChange={setOrderType}
            variant="tabs"
            className="mb-3.5"
            labels={{ Limit: t('dex.order.limit'), Market: t('dex.order.market'), Stop: t('dex.order.stop') }}
          />

          <View className="gap-2">
            <Field label={t('dex.price')} value={market !== null ? market.price.toFixed(4) : '-'} unit="USDT" />
            <Field label={t('common.amount')} value={amount} unit="ML" onChangeText={setAmount} />
            <PctButtons onPick={(f) => setAmount(String(Math.round(mlBalance * f)))} />
            <Field label={t('common.total')} value={total} unit="USDT" tone={C.text1} />
          </View>

          {orderType !== 'Limit' && (
            <Txt className="text-[11px] mt-2" style={{ color: C.amber }}>
              {t('dex.order.typeUnsupported')}
            </Txt>
          )}

          <Btn tone={side === 'buy' ? 'green' : 'red'} className="mt-3.5" disabled={placing || market === null || orderType !== 'Limit'} onPress={() => setConfirmOpen(true)}>
            {t('dex.order.place')}
          </Btn>
          {ticketError && (
            <Txt className="text-[11px] mt-2" style={{ color: C.red }}>
              {ticketError}
            </Txt>
          )}
          {lastDemoNote && (
            <Txt className="text-[11px] mt-2" style={{ color: C.amber }}>
              {lastDemoNote}
            </Txt>
          )}

          <View className="mt-3 gap-1">
            <KVRow k={t('common.networkFee')} v={t('dex.networkFeeValue', { fee: String(fees.standard.cost), usd: market !== null ? `$${usd(fees.standard.cost, market.price)}` : '-' })} />
            <KVRow k={t('dex.onchainSettlement')} v={t('dex.settlementEta')} tone={C.teal} />
          </View>
        </Card>
      </View>

      {/* My orders: fill and conclude on orders flagged as mine. */}
      <View className="px-5 pt-5 pb-6">
        <Card className="p-4">
          <Label>{t('dex.order.mine')}</Label>
          {ordersError && (
            <Txt className="text-[11px] mt-2" style={{ color: C.red }}>
              {ordersError}
            </Txt>
          )}
          {myOrders !== null && myOrders.length === 0 && (
            <Txt className="text-[11px] text-text2 mt-2">{t('dex.orders.empty')}</Txt>
          )}
          {myOrders?.map((order) => (
            <MyOrderRow
              key={order.orderId}
              order={order}
              usdtDecimals={askDecimals}
              onDone={() => void loadMyOrders()}
              onError={setTicketError}
              onFill={openFill}
            />
          ))}
        </Card>
      </View>

      {/* Confirm sheet: the exact give and ask amounts before anything is
          built (spec order entry guards). */}
      <Sheet open={confirmOpen} onClose={() => setConfirmOpen(false)} title={t('dex.order.confirm.title')}>
        <View className="gap-2">
          <KVRow k={t('dex.order.give')} v={side === 'buy' ? `${total} USDT` : `${amount} ML`} />
          <KVRow k={t('dex.order.ask')} v={side === 'buy' ? `${amount} ML` : `${total} USDT`} />
          <KVRow k={t('dex.book.asks')} v={bestAsk ? bestAsk.toFixed(4) : '-'} />
          <KVRow k={t('dex.book.bids')} v={bestBid ? bestBid.toFixed(4) : '-'} />
        </View>
        {mode === 'mock' && (
          <Txt className="text-[11px] mt-3" style={{ color: C.amber }}>
            {t('dex.dev.demoBanner')}
          </Txt>
        )}
        <Btn tone={side === 'buy' ? 'green' : 'red'} className="mt-4" disabled={placing} onPress={() => void placeOrder()}>
          {placing ? t('dex.order.working') : t('dex.order.place')}
        </Btn>
      </Sheet>

      {/* Fill confirmation: the payout preview and the effective price
          before anything is built (spec order entry guards). */}
      <Sheet open={fillSheet !== null} onClose={() => setFillSheet(null)} title={t('dex.fill.confirm.title')}>
        {fillSheet && (
          <>
            <View className="gap-2">
              <KVRow k={t('dex.fill.pay')} v={`${atomsToDecimal(fillSheet.order.askBalanceAtoms, fillSheet.legs.payDecimals)} ${fillSheet.legs.paySymbol}`} />
              <KVRow k={t('dex.fill.receive')} v={`${atomsToDecimal(fillSheet.payout, fillSheet.legs.receiveDecimals)} ${fillSheet.legs.receiveSymbol}`} />
              <KVRow k={t('dex.fill.effective')} v={`${fillSheet.effective} ${fillSheet.legs.paySymbol}/${fillSheet.legs.receiveSymbol}`} />
              <KVRow k={t('dex.book.mid')} v={fillSheet.mid} />
            </View>
            {Number(fillSheet.effective) > 0 && Number(fillSheet.mid) > 0 && (Math.abs(Number(fillSheet.effective) - Number(fillSheet.mid)) / Number(fillSheet.mid)) * 100 > MAX_SLIPPAGE_PCT && (
              <Txt className="text-[11px] mt-3" style={{ color: C.red }}>
                {t('dex.fill.slippageWarn', { drift: ((Math.abs(Number(fillSheet.effective) - Number(fillSheet.mid)) / Number(fillSheet.mid)) * 100).toFixed(2) })}
              </Txt>
            )}
            <Btn tone="green" className="mt-4" disabled={placing} onPress={() => void runFill()}>
              {placing ? t('dex.order.working') : t('dex.fill.cta')}
            </Btn>
          </>
        )}
      </Sheet>
    </Screen>
  );
}

/** Order flow failures to screen copy (device-pending and config-pending
 *  stay explicit: nothing reads as sent when it was not). Generic order
 *  rejections (malformed fill amounts, non-computable legs, zero payout)
 *  get their own copy: the book-unreachable line misstates the failure. */
function orderErrorCopy(e: unknown): string {
  if (isBindingsUnavailable(e)) return t('dex.order.signingPending');
  const record = e as { reason?: string } | null;
  if (record && typeof record.reason === 'string') {
    if (record.reason === 'broadcast-disabled') return t('dex.order.broadcastOff');
    if (record.reason === 'not-mine') return t('errors.orders.notMine');
    if (record.reason === 'not-open') return t('errors.orders.notOpen');
    if (record.reason === 'overbid') return t('errors.orders.overbid');
    if (record.reason === 'slippage') return t('errors.orders.slippage');
    if (record.reason === 'busy') return t('dex.order.busy');
  }
  return t('dex.order.rejected');
}

function MyOrderRow({ order, usdtDecimals, onDone, onError, onFill }: { order: OrderData; usdtDecimals: number; onDone: () => void; onError: (message: string) => void; onFill: (order: OrderData) => void }) {
  const { orders } = useProviders();
  const phase = orderPhase(order);
  const [busy, setBusy] = useState(false);
  const legs = pairLegs(order, usdtDecimals);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      onDone();
    } catch (e) {
      onError(orderErrorCopy(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View className="mt-3 pt-3" style={{ borderTopWidth: 1, borderTopColor: C.lineSoft }}>
      <View className="flex-row justify-between items-center">
        <Txt mono className="text-[11px] text-text2">
          {`${order.orderId.slice(0, 18)}…`}
        </Txt>
        <Chip tone={phase === 'open' ? C.green : phase === 'frozen' ? C.amber : C.text3} dot={false}>
          {t(phase === 'frozen' ? 'dex.order.frozen' : phase === 'concluded' ? 'dex.order.concluded' : 'dex.order.mine')}
        </Chip>
      </View>
      <Txt mono className="text-[11px] text-text2 mt-1">
        {`give ${atomsToDecimal(order.giveBalanceAtoms, legs.receiveDecimals)} ${legs.receiveSymbol} · ask ${atomsToDecimal(order.askBalanceAtoms, legs.payDecimals)} ${legs.paySymbol}`}
      </Txt>
      {phase !== 'concluded' && (
        <View className="flex-row gap-2 mt-2">
          <Btn
            tone="ghost"
            className="flex-1"
            disabled={busy}
            onPress={() => onFill(order)}>
            {t('dex.fill.cta')}
          </Btn>
          <Btn
            tone="red"
            className="flex-1"
            disabled={busy}
            onPress={() => void run(() => orders.concludeOrder({ orderId: order.orderId }))}>
            {t('dex.conclude.cta')}
          </Btn>
        </View>
      )}
    </View>
  );
}

/** Direction legs for a displayed-pair order (the myOrders load filter
 *  guarantees ML/USDT on both legs, either direction): the fill pays the
 *  order's ask currency and receives the give currency, each at its own
 *  decimals. */
function pairLegs(order: OrderData, usdtDecimals: number): { payDecimals: number; paySymbol: string; receiveDecimals: number; receiveSymbol: string } {
  const giveIsMl = order.giveTokenId === COIN_REF;
  return {
    payDecimals: giveIsMl ? usdtDecimals : ML_DECIMALS,
    paySymbol: giveIsMl ? 'USDT' : 'ML',
    receiveDecimals: giveIsMl ? ML_DECIMALS : usdtDecimals,
    receiveSymbol: giveIsMl ? 'ML' : 'USDT',
  };
}

/** Order-book line with a depth bar filling from the right. */

function BookRow({ row, max, tone, delay }: { row: { price: string; size: string; total: string }; max: number; tone: string; delay: number }) {
  const totalNumber = Number(row.total || 0);
  return (
    <Enter delay={delay} duration={400} offset={6}>
      <View className="flex-row items-center px-4 py-1.5">
        <View className="absolute right-0 top-0 bottom-0" style={{ width: `${max > 0 ? Math.min(100, (totalNumber / max) * 100) : 0}%`, backgroundColor: alpha(tone, 0.18) }} />
        <Txt mono className="flex-1 text-[12px]" style={{ color: tone }}>
          {Number(row.price).toFixed(4)}
        </Txt>
        <Txt mono className="flex-1 text-[12px] text-text1 text-center">
          {Number(row.size).toLocaleString()}
        </Txt>
        <Txt mono className="flex-1 text-[12px] text-text2 text-right">
          {totalNumber.toLocaleString()}
        </Txt>
      </View>
    </Enter>
  );
}
