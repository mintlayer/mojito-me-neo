import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Sheet } from './types';
import { Alert, Linking, Pressable, ScrollView, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { t, type I18nKey } from '../i18n';
import { useData, useProviders } from '../data/providers/context';
import { endpointsFor } from '../config/endpoints';
import type { FeeTierId, SendQuote, SendResult } from '../data/providers';
import type { TrackedTx, TxTracker } from '../send/TxTracker';
import { validateAddress, parseSendAmount, type AddressChain } from '../send/validation';
import { addressErrorCopy, amountErrorCopy, sendErrorCopy } from '../send/errors';
import { bioName } from '../onboarding/context';
import { atomsToDecimal, decimalsToAtoms } from '../money';
import { C, G } from '../theme';
import { Avatar, Btn, Callout, Card, ChainBadge, Icon, KVRow, Label, PctButtons, Screen, SheetHeader, SuccessScreen, TokenIcon, TokenPicker, Txt, tint, quantizeAmount, tile, truncateMiddle, usd, hairlineTop } from '../ui';

function chainOf(chainName: string): AddressChain {
  return chainName === 'Bitcoin' ? 'btc' : 'ml';
}

/** True when the reviewed asset is an MLS-01 token (the fee is then paid
 *  in ML coin, never in the token, so fee and total keep single units). */
function isTokenSend(chain: AddressChain, tokenId?: string): boolean {
  return chain === 'ml' && tokenId !== undefined;
}

/** Fee unit per reviewed asset: BTC sends show sat-denominated BTC, ML
 *  token sends pay the fee in ML, everything else in the asset itself. */
function feeSymbol(chain: AddressChain, tokenSym: string, tokenId?: string): string {
  if (chain === 'btc') return 'BTC';
  return isTokenSend(chain, tokenId) ? 'ML' : tokenSym;
}

/** Review total on exact digit strings (money.ts, no float arithmetic):
 *  both legs convert to atoms, add on BigInt and render back. Token sends
 *  total the token leg only; their fee is its own ML row. */
function reviewTotal(amountDecimal: string, feeDecimal: string, decimals: number, token: boolean): string {
  if (token) return amountDecimal;
  const sum = BigInt(decimalsToAtoms(amountDecimal || '0', decimals)) + BigInt(decimalsToAtoms(feeDecimal, decimals));
  return atomsToDecimal(sum.toString(), decimals);
}

/** Default decimals when the asset row carries none (fixture assets). */
function decimalsOf(chainName: string, decimals?: number): number {
  if (decimals !== undefined) return decimals;
  return chainName === 'Bitcoin' ? 8 : 11;
}

/** Explorer URL per chain from the endpoints config; null hides the link. */
function explorerUrl(kind: 'ml' | 'btc', txId: string, network: 'mainnet' | 'testnet'): string | null {
  const endpoints = endpointsFor(network);
  const base = kind === 'btc' ? endpoints.btcExplorerBase : endpoints.explorerBase;
  return base === null ? null : `${base}/tx/${txId}`;
}

/** Subscribe to one tracked transaction while mounted. */
function useTrackedTx(tracker: TxTracker, kind: 'ml' | 'btc' | null, txId: string | null): TrackedTx | null {
  const [state, setState] = useState<TrackedTx | null>(null);
  useEffect(() => {
    if (kind === null || txId === null) return undefined;
    const sync = () => setState(tracker.get(kind, txId));
    sync();
    return tracker.subscribe(sync);
  }, [tracker, kind, txId]);
  return state;
}

export function SendScreen({ onClose, bio = 'face', network = 'mainnet' }: Sheet) {
  const { send, txTracker } = useProviders();
  const assets = useData((d) => d.getAssets());
  const assetBalances = useData((d) => d.getAssetBalances());
  const assetSymbols = useData((d) => d.getAssetSymbols());
  const contacts = useData((d) => d.getContacts());
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [tokenSym, setTokenSym] = useState('ML');
  const [picker, setPicker] = useState(false);
  const [address, setAddress] = useState('');
  const [addressError, setAddressError] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);
  const [feeTier, setFeeTier] = useState<FeeTierId>('standard');
  const [quote, setQuote] = useState<SendQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const txState = useTrackedTx(txTracker, result?.kind ?? null, result?.txId ?? null);
  /** Quote debounce: a keystroke storm must not hammer the fee planners. */
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const token = assets?.find((a) => a.sym === tokenSym) ?? assets?.[0];
  const chain = token === undefined ? 'ml' : chainOf(token.chain);
  const decimals = token === undefined ? 11 : decimalsOf(token.chain, token.decimals);
  const canBroadcast = send.canBroadcast(chain);

  const onAddressChange = useCallback(
    (text: string) => {
      setAddress(text);
      const error = validateAddress(text, chain, network);
      setAddressError(error === null ? null : addressErrorCopy(error));
    },
    [chain, network],
  );

  const onAmountChange = useCallback(
    (text: string) => {
      setAmount(text);
      const parsed = parseSendAmount(text, decimals);
      setAmountError(parsed.ok ? null : amountErrorCopy(parsed.error));
    },
    [decimals],
  );

  // Live per-tier quotes (debounced) while the details settle on step 0;
  // the review entry re-quotes so the reviewed numbers are fresh (fee
  // pinning reads this quote's BTC rate into the confirm call).
  const loadQuote = useCallback(() => {
    const load =
      chain === 'btc'
        ? send.quoteBtc({ to: address.trim(), amountDecimal: amount })
        : send.quoteMl({ to: address.trim(), amountDecimal: amount, decimals, tokenId: token?.tokenId });
    load
      .then((q) => {
        setQuote(q);
        setQuoteError(null);
      })
      .catch((e: unknown) => {
        setQuote(null);
        setQuoteError(sendErrorCopy(e));
      });
  }, [address, amount, chain, decimals, token, send]);

  useEffect(() => {
    if (step !== 0) return undefined;
    if (addressError !== null || amountError !== null || address === '' || amount === '') {
      setQuote(null);
      setQuoteError(null);
      return undefined;
    }
    if (quoteTimer.current !== null) clearTimeout(quoteTimer.current);
    quoteTimer.current = setTimeout(loadQuote, 400);
    return () => {
      if (quoteTimer.current !== null) clearTimeout(quoteTimer.current);
    };
  }, [step, address, amount, addressError, amountError, loadQuote]);

  const openReview = useCallback(() => {
    if (quoteTimer.current !== null) clearTimeout(quoteTimer.current);
    setQuote(null);
    setQuoteError(null);
    loadQuote();
    setStep(1);
  }, [loadQuote]);

  const paste = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text.length > 0) onAddressChange(text.trim());
    } catch {
      // Clipboard unavailable: the field stays editable by hand.
    }
  };

  const confirm = () => {
    if (token === undefined || sending) return;
    setSending(true);
    setSendError(null);
    const reviewed = quote?.[feeTier];
    const btcParams = {
      to: address.trim(),
      amountDecimal: amount,
      tier: feeTier,
      satPerVbyte: reviewed?.satPerVbyte,
      rateIsFallback: reviewed?.rateIsFallback,
    };
    const mlParams = { to: address.trim(), amountDecimal: amount, decimals, tier: feeTier, tokenId: token.tokenId };
    const flow = chain === 'btc' ? send.sendBtc(btcParams) : send.sendMl(mlParams);
    flow
      .then((r) => {
        setResult(r);
        setStep(2);
      })
      .catch((e: unknown) => {
        setSendError(sendErrorCopy(e));
      })
      .finally(() => setSending(false));
  };

  if (!assets || !assetBalances || !assetSymbols || !contacts || !token) return <Screen />;

  if (step === 2 && result !== null) {
    const txUrl = explorerUrl(result.kind, result.txId, network);
    const confirmed = txState?.state === 'confirmed';
    // An unknown confirmation count must not render as a zero: the count
    // less copy covers the tip-read failure and count-less backends.
    const confirmationCount = txState?.confirmations ?? null;
    return (
      <SuccessScreen
        title={t('send.success.title')}
        summary={`${amount} ${token.sym} → ${truncateMiddle(address, 12, 8)}`}
        onDone={onClose}
        header={<SheetHeader onClose={onClose} />}
        secondary={
          txUrl !== null ? (
            <Btn tone="ghost" className="w-full mt-1" onPress={() => void Linking.openURL(txUrl)}>
              {t('common.seeExplorer')}
            </Btn>
          ) : (
            <Txt className="text-[11px] text-text3 mt-2 text-center">{t('common.explorer.unavailable')}</Txt>
          )
        }>
        <Card className="w-full mt-6 p-3.5 rounded-[14px] gap-2">
          <KVRow k={t('send.txHash')} v={truncateMiddle(result.txId)} tone={C.text1} />
          {confirmed ? (
            <KVRow
              k={t('send.status')}
              v={confirmationCount === null ? t('send.success.confirmedUnknown') : t('send.success.confirmed', { count: confirmationCount })}
              tone={C.green}
            />
          ) : (
            <KVRow k={t('send.status')} v={t('send.success.pending')} tone={C.amber} />
          )}
        </Card>
        {result.demo ? (
          <Callout glyph="ⓘ" className="mt-3.5">
            <Txt className="text-[12px]">{t('home.demoData')}</Txt>
          </Callout>
        ) : null}
        {result.warning ? (
          <Callout tone={C.amber} glyph="!" className="mt-3.5">
            <Txt className="text-[11.5px]">{t('send.success.warning')}</Txt>
          </Callout>
        ) : null}
      </SuccessScreen>
    );
  }

  if (step === 1) {
    const leg = quote?.[feeTier];
    const feeText = leg !== undefined ? `${leg.feeDecimal} ${feeSymbol(chain, token.sym, token.tokenId)}` : t('send.fee.unavailable');
    const rateText =
      leg === undefined
        ? undefined
        : chain === 'btc'
          ? leg.satPerVbyte !== undefined
            ? t('send.fee.rateBtc', { rate: leg.satPerVbyte })
            : undefined
          : leg.rateAtomsPerKb !== undefined
            ? t('send.fee.rate', { rate: leg.rateAtomsPerKb })
            : undefined;
    const etaKey = (chain === 'btc' ? 'send.fee.eta.' : 'send.fee.eta.ml.') + feeTier;
    const total = leg !== undefined ? reviewTotal(amount, leg.feeDecimal, decimals, isTokenSend(chain, token.tokenId)) : amount;
    const totalText = `${total} ${token.sym}`;
    const rows: [string, React.ReactNode][] = [
      [t('send.to.label'), <Txt key="to" mono className="text-[12px]">{truncateMiddle(address, 14, 10)}</Txt>],
      [t('send.network'), <ChainBadge key="net" chain={token.chain} />],
      [t('common.networkFee'), feeText],
      [t('send.arrival'), <Txt key="eta" className="text-[12px]" style={{ color: C.amber }}>{t(etaKey as I18nKey)}</Txt>],
    ];
    if (rateText !== undefined) rows.push([t('send.fee.rate'), rateText]);
    rows.push([t('common.total'), totalText]);
    return (
      <Screen>
        <SheetHeader title={t('send.review.title')} onClose={onClose} onBack={() => setStep(0)} />
        <View className="px-6 pt-5">
          <View className="items-center mb-4">
            <Label>{t('common.youSend')}</Label>
            <View className="flex-row items-baseline gap-1.5 mt-1.5">
              <Txt mono className="text-[38px] font-bold tracking-tightest">
                {amount}
              </Txt>
              <Txt className="text-[18px] text-text2">{token.sym}</Txt>
            </View>
            <Txt mono className="text-[13px] text-text2 mt-1">
              {t('common.approxUsd', { usd: `$${usd(amount, token.price)}` })}
            </Txt>
          </View>

          <Card className="p-3.5 rounded-[14px]">
            {rows.map(([k, v], i) => (
              <View key={k} className="py-2.5" style={i > 0 ? hairlineTop : undefined}>
                <KVRow k={k} v={v} tone={C.text0} />
              </View>
            ))}
          </Card>

          {leg?.rateIsFallback ? (
            <Callout tone={C.amber} glyph="!" className="mt-3.5">
              <Txt className="text-[11.5px] text-text1 leading-[17px]">{t('send.fee.fallback')}</Txt>
            </Callout>
          ) : null}
          {!canBroadcast ? (
            <Callout tone={C.amber} glyph="!" className="mt-3.5">
              <Txt className="text-[11.5px] text-text1 leading-[17px]">{t('send.error.broadcast.disabled')}</Txt>
            </Callout>
          ) : null}
          {sendError !== null ? (
            <Callout tone={C.red} glyph="!" className="mt-3.5">
              <Txt className="text-[11.5px] text-text1 leading-[17px]">{sendError}</Txt>
            </Callout>
          ) : null}

          <Callout icon="fingerprint" className="mt-3.5">
            <Txt className="text-[12px]">{t('send.authBio', { bio: bioName(bio) })}</Txt>
          </Callout>

          <Btn tone="primary" icon="lock" className="mt-4" disabled={sending || leg === undefined} onPress={confirm}>
            {sending ? t('send.review.broadcasting') : t('send.review.confirm')}
          </Btn>
        </View>
      </Screen>
    );
  }

  const detailsReady =
    addressError === null && amountError === null && address.trim().length > 0 && amount.length > 0 && quote !== null;

  return (
    <Screen>
      <SheetHeader title={t('send.title')} onClose={onClose} />

      {/* Asset */}
      <View className="px-6 pt-2">
        <Label className="mb-2">{t('send.asset')}</Label>
        <Pressable onPress={() => setPicker(true)}>
          <Card className="p-3.5 rounded-[14px] flex-row items-center gap-3">
            <TokenIcon symbol={token.sym} size={36} />
            <View className="flex-1">
              <View className="flex-row items-center gap-1.5">
                <Txt className="text-[14px] font-semibold">{token.sym}</Txt>
                <ChainBadge chain={token.chain} />
              </View>
              <Txt mono className="text-[11px] text-text2 mt-0.5">
                {t('common.bal', { bal: token.amt.toLocaleString(), sym: token.sym })}
              </Txt>
            </View>
            <Icon name="chevron_r" size={14} color={C.text2} />
          </Card>
        </Pressable>
      </View>

      <TokenPicker
        open={picker}
        onClose={() => setPicker(false)}
        symbols={assetSymbols}
        value={token.sym}
        balances={assetBalances}
        onSelect={(s) => {
          if (assets.some((a) => a.sym === s)) {
            setTokenSym(s);
            setAmount('');
            setAmountError(null);
            setQuote(null);
          }
        }}
      />

      {/* Amount */}
      <View className="px-6 pt-5 items-center">
        <View className="flex-row items-baseline gap-1.5">
          <TextInput
            value={amount}
            onChangeText={onAmountChange}
            placeholder="0"
            placeholderTextColor={C.text3}
            keyboardType="decimal-pad"
            accessibilityLabel={t('send.amount.a11y')}
            className="font-mono text-[56px] font-bold text-text0 text-center p-0 min-w-[80px]"
          />
          <Txt className="text-[20px] text-text2 font-medium">{token.sym}</Txt>
        </View>
        <Txt mono className="text-[13px] text-text2 mt-1">
          {t('common.approxUsd', { usd: `$${usd(amount, token.price)}` })}
        </Txt>
        {amountError !== null ? (
          <Txt className="text-[11px] mt-1" style={{ color: C.red }}>
            {amountError}
          </Txt>
        ) : null}
        <View className="w-full mt-3.5">
          <PctButtons onPick={(f) => onAmountChange(quantizeAmount(token.amt * f, decimals))} />
        </View>
      </View>

      {/* Recipient */}
      <View className="px-6 pt-6">
        <View className="flex-row justify-between mb-2">
          <Label>{t('send.recipient')}</Label>
          <Txt className="text-[11px]" style={{ color: C.amber }}>
            {t('send.addressBook')}
          </Txt>
        </View>
        <Card className="p-3.5 rounded-[14px] flex-row items-center gap-2.5">
          <TextInput
            value={address}
            onChangeText={onAddressChange}
            placeholder={t('send.to.placeholder')}
            placeholderTextColor={C.text3}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={t('send.address.a11y')}
            className="flex-1 font-mono text-[13px] text-text0 p-0"
          />
          <Pressable onPress={() => void paste()} accessibilityLabel={t('send.to.paste')} hitSlop={8}>
            <Txt className="text-[11px] font-semibold" style={{ color: C.amber }}>
              {t('send.to.paste')}
            </Txt>
          </Pressable>
          <Pressable
            onPress={() => Alert.alert(t('send.title'), t('send.scan.unavailable'))}
            accessibilityLabel={t('send.scan.unavailable')}
            hitSlop={8}>
            <Icon name="qr" size={18} color={C.text2} />
          </Pressable>
        </Card>
        {addressError !== null ? (
          <Txt className="text-[11px] mt-1.5" style={{ color: C.red }}>
            {addressError}
          </Txt>
        ) : null}

        {/* Recipient chips are a mock-mode affordance only: the real-mode
            contact list is empty until real contacts ship (M3 spec). */}
        {contacts.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 10 }}>
            {contacts.map((c) => (
              <Pressable
                key={c.name}
                onPress={() => onAddressChange(c.address)}
                className="flex-row items-center gap-2 px-3 py-2 rounded-full"
                style={tile()}>
                <Avatar letter={c.name[0]} size={22} radius={11} colors={G.avatar} />
                <Txt className="text-[12px] font-medium">{c.name}</Txt>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>

      {/* Fee tier */}
      <View className="px-6 pt-5">
        <Label className="mb-2">{t('common.networkFee')}</Label>
        <View className="flex-row gap-1.5">
          {(['economy', 'standard', 'fast'] as FeeTierId[]).map((k) => {
            const on = feeTier === k;
            const leg = quote?.[k];
            return (
              <Pressable
                key={k}
                onPress={() => setFeeTier(k)}
                className="flex-1 p-3 rounded-xl"
                style={on ? tint(C.amber, 0.08, 0.4) : tile(0.03)}>
                <Txt className="text-[12px] font-semibold capitalize" style={{ color: on ? C.amber : C.text0 }}>
                  {t(`send.fee.${k}` as I18nKey)}
                </Txt>
                <Txt mono className="text-[10px] text-text2 mt-0.5">
                  {t(((chain === 'btc' ? 'send.fee.eta.' : 'send.fee.eta.ml.') + k) as I18nKey)}
                </Txt>
                <Txt mono className="text-[10px] text-text3 mt-0.5">
                  {leg !== undefined ? `${leg.feeDecimal} ${feeSymbol(chain, token.sym, token.tokenId)}` : t('send.fee.unavailable')}
                </Txt>
              </Pressable>
            );
          })}
        </View>
        {quoteError !== null ? (
          <Callout tone={C.amber} glyph="!" className="mt-2.5">
            <Txt className="text-[11.5px] text-text1 leading-[17px]">{quoteError}</Txt>
          </Callout>
        ) : null}
        {chain === 'ml' && !send.canBroadcast('ml') ? (
          <Txt className="text-[11px] text-text2 mt-2 leading-[16px]">{t('send.chain.mlPending')}</Txt>
        ) : null}
        {chain === 'btc' && !send.canBroadcast('btc') ? (
          <Txt className="text-[11px] text-text2 mt-2 leading-[16px]">{t('send.chain.btcUnconfigured')}</Txt>
        ) : null}
      </View>

      <View className="px-6 pt-6">
        <Btn tone="primary" disabled={!detailsReady} onPress={openReview}>
          {t('send.review.cta')}
        </Btn>
      </View>
    </Screen>
  );
}

/* ══ Send ═════════════════════════════════════════════════ */
