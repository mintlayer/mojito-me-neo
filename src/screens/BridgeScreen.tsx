import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient as SvgGrad, Path, Stop } from 'react-native-svg';
import { t } from '../i18n';
import { useData, useProviders } from '../data/providers/context';
import { decimalsToAtoms, atomsToDecimal } from '../money';
import { C, CHAINS, G, alpha } from '../theme';
import type { ChainName } from '../theme';
import { AmountRow, Btn, Callout, Card, ChainGlyph, FlowX, Icon, KVGrid, KVRow, Label, PickerSheet, Screen, ScreenIntro, Txt, hairlineTop, tile } from '../ui';

/** The real bridge scope (F14, R5): exactly these two chains, with the E2M
 *  direction disabled pending the EVM signer decision. */
const HOME_CHAIN = 'Mintlayer';
const COUNTERPARTY_CHAIN = 'Ethereum' as ChainName;

export function BridgeScreen() {
  const assets = useData((d) => d.getAssets());
  const assetBalances = useData((d) => d.getAssetBalances());
  const { bridge, mode } = useProviders();
  const [amount, setAmount] = useState('500.00');
  // M2E demo asset: the fees route carries the per-token rows; the picker
  // lands with the multi-token deposit flow (v2).
  const token = 'USDT';
  const [chainPicker, setChainPicker] = useState(false);
  const [quote, setQuote] = useState<{ feePct: string; feeAmount: string; confirmationsRequired?: number; destContractOrAddress: string } | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  /** Honest gate states: quote refresh, CTA gate and the tracking handle. */
  const [gateError, setGateError] = useState<string | null>(null);
  const [tracking, setTracking] = useState<{ id: string; state: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const src = HOME_CHAIN;
  const dst = COUNTERPARTY_CHAIN;

  const loadQuote = useCallback(async () => {
    setQuoteError(null);
    try {
      const result = await bridge.quote({ route: 'M2E', token, amount, destAddr: '' });
      setQuote(result);
    } catch (e) {
      setQuote(null);
      setQuoteError(bridgeErrorCopy(e));
    }
  }, [bridge, token, amount]);

  // Debounced quote refresh: /fees and /agents-config must not refetch on
  // every keystroke of the amount row.
  useEffect(() => {
    const timer = setTimeout(() => void loadQuote(), 500);
    return () => clearTimeout(timer);
  }, [loadQuote]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  if (!assets || !assetBalances) return <Screen />;
  const tokenBalance = assets.find((a) => a.sym === token)?.amt ?? 0;
  const receiveAmount = quote
    ? atomsToDecimal((BigInt(decimalsToAtoms(amount, 18)) - BigInt(decimalsToAtoms(quote.feeAmount, 18))).toString(), 18)
    : null;

  /** The CTA: mock mode runs the simulated bridge walk (demo chip copy);
   *  real mode hits the honest gate (no deposit intent encoder, R3 route
   *  unconfigured), so nothing reads as started when it was not. */
  const startBridge = async () => {
    setGateError(null);
    try {
      const handle = await bridge.initiate({ route: 'M2E', token, amount, destAddr: '' });
      setTracking({ id: handle.id, state: t('bridge.state.awaitingDeposit') });
      pollRef.current = setInterval(() => {
        void (async () => {
          try {
            const state = await bridge.status(handle);
            setTracking({ id: handle.id, state: bridgeStateCopy(state) });
          } catch {
            setTracking((prev) => prev);
          }
        })();
      }, 10_000);
      setSubmitted(true);
    } catch (e) {
      setGateError(bridgeErrorCopy(e));
    }
  };

  if (submitted) {
    return (
      <Screen>
        <ScreenIntro title={t('bridge.success.title')} chip={t('bridge.chip')} tone={C.violet} blurb={t('bridge.blurb')} />
        <View className="px-5 pt-4">
          <Card className="p-4">
            <Label>{t('bridge.tracking.title')}</Label>
            <Txt mono className="text-[12px] text-text2 mt-2">
              {tracking?.state ?? t('bridge.state.awaitingDeposit')}
            </Txt>
            <Txt mono className="text-[10px] text-text3 mt-1">
              {tracking?.id.slice(0, 24)}…
            </Txt>
            <Btn tone="violet" className="mt-4" onPress={() => setSubmitted(false)}>
              {t('common.done')}
            </Btn>
          </Card>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenIntro title={t('bridge.title')} chip={t('bridge.chip')} tone={C.violet} blurb={t('bridge.blurb')} />

      {mode === 'mock' && (
        <View className="px-5 pt-4">
          <Callout tone={C.violet} icon="bridge">{t('bridge.dev.mockBanner')}</Callout>
        </View>
      )}
      {gateError && (
        <View className="px-5 pt-4">
          <Callout tone={C.red} icon="shield" accessibilityRole="alert">{gateError}</Callout>
        </View>
      )}

      <PickerSheet
        open={chainPicker}
        onClose={() => setChainPicker(false)}
        title={t('bridge.to')}
        options={[COUNTERPARTY_CHAIN]}
        value={dst}
        onSelect={() => undefined}
        renderLeading={(n) => <ChainGlyph chain={n} size={28} />}
        subtitleFor={(n) => t(n === 'Ethereum' ? 'bridge.chain.ethereum' : 'bridge.chain.mintlayer')}
      />

      {/* Tunnel */}
      <View className="px-5 pt-6">
        <Card grad={G.raisedViolet} className="px-5 py-7 rounded-[22px]">
          <View className="flex-row items-center gap-3">
            <ChainCard name={src} side={t('bridge.sideFrom')} />
            <View
              className="w-9 h-9 rounded-xl items-center justify-center"
              style={{ backgroundColor: C.bg1, borderWidth: 1, borderColor: C.line }}>
              <Icon name="swap" size={14} color={C.violet} />
            </View>
            <ChainCard name={dst} side={t('bridge.sideTo')} />
          </View>

          <View className="h-[60px] mt-6 justify-center">
            <Svg width="100%" height={60} viewBox="0 0 320 60" preserveAspectRatio="none">
              <Defs>
                <SvgGrad id="tunnel" x1="0" y1="0" x2="1" y2="0">
                  {G.tunnel.map((c, i) => (
                    <Stop key={c} offset={i / (G.tunnel.length - 1)} stopColor={c} />
                  ))}
                </SvgGrad>
                <SvgGrad id="tunnelDim" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor={C.teal} stopOpacity={0.2} />
                  <Stop offset="1" stopColor={C.violet} stopOpacity={0.2} />
                </SvgGrad>
              </Defs>
              {[0, 1, 2, 3, 4].map((i) => (
                <Path
                  key={i}
                  d={`M 10 ${30 + (i - 2) * 6} Q 160 ${30 + (i - 2) * 14} 310 ${30 + (i - 2) * 6}`}
                  stroke="url(#tunnelDim)"
                  strokeWidth={0.8}
                  fill="none"
                  opacity={0.7 - i * 0.08}
                />
              ))}
              <Path d="M 10 30 Q 160 30 310 30" stroke="url(#tunnel)" strokeWidth={2.5} fill="none" />
            </Svg>
            {[0, 500, 1000, 1500].map((d) => (
              <View key={d} className="absolute left-2.5 right-2.5 h-2 top-[26px]" pointerEvents="none">
                <FlowX track={280} duration={2600} delay={d}>
                  <View className="w-2 h-2 rounded-full" style={{ backgroundColor: C.ice }} />
                </FlowX>
              </View>
            ))}
            <View
              className="absolute self-center px-3 py-1 rounded-lg"
              style={{ backgroundColor: alpha(C.bg1, 0.9), borderWidth: 1, borderColor: C.line }}>
              <Txt mono className="text-[10px] font-semibold tracking-wider" style={{ color: C.violet }}>
                {t('bridge.badge')}
              </Txt>
            </View>
          </View>

          {/* Finality only applies to the destination side. */}
          <View className="mt-1 items-end">
            <Txt mono className="text-[10px] text-text3">
              {t('bridge.finalOn', { chain: dst.toUpperCase() })}
            </Txt>
          </View>
        </Card>
      </View>

      {/* Amount */}
      <View className="px-5 pt-4">
        <Card className="p-4 rounded-[18px]">
          <View className="flex-row justify-between items-center mb-3">
            <Label>{t('common.amount')}</Label>
            <Txt mono className="text-[11px] text-text2">
              {t('bridge.available', { amount: tokenBalance.toLocaleString(), token })}
            </Txt>
          </View>
          <AmountRow symbol={token} value={amount} onChangeText={setAmount} />
        </Card>
      </View>

      {/* Route steps and the live quote (real provider or dev mock). */}
      <View className="px-5 pt-4">
        <Label className="mb-2">{t('bridge.route')}</Label>
        <Card className="p-3.5 rounded-2xl">
          {quoteError && (
            <Txt className="text-[11px] mb-2" style={{ color: C.red }}>
              {quoteError}
            </Txt>
          )}
          <View className="mt-1 gap-1">
            {quote && (
              <>
                <KVRow k={t('bridge.quote.fee')} v={`${quote.feePct} · ${quote.feeAmount} ${token}`} tone={C.violet} />
                {quote.confirmationsRequired !== undefined && (
                  <KVRow k={t('bridge.quote.confirmations')} v={String(quote.confirmationsRequired)} />
                )}
                {receiveAmount !== null && <KVRow k={t('bridge.quote.receive')} v={`${receiveAmount} ${token}`} />}
                <KVRow k={t('bridge.quote.depositAddress')} v={`${quote.destContractOrAddress.slice(0, 18)}…`} />
              </>
            )}
            {!quote && !quoteError && <KVRow k={t('bridge.quote.fee')} v={t('swap.state.pending')} />}
          </View>
          {quote?.confirmationsRequired !== undefined && (
            <View className="mt-2.5 pt-2.5" style={hairlineTop}>
              <KVGrid rows={[[t('bridge.quote.eta'), `~${quote.confirmationsRequired} ${t('bridge.quote.confirmations')}`]]} />
            </View>
          )}
        </Card>
      </View>

      {/* E2M direction: disabled with the honest R5 copy (never silently
          dropped; the scoped EVM signer decision stays open). */}
      <View className="px-5 pt-4">
        <Card className="p-4">
          <Txt className="text-[11px] text-text2 leading-[16px]">{t('bridge.route.e2m.unavailable')}</Txt>
        </Card>
      </View>

      <View className="px-5 pt-4 pb-6">
        <Btn tone="violet" icon="bridge" onPress={() => void startBridge()}>
          {t('bridge.cta', { amount, token, chain: dst })}
        </Btn>
      </View>
    </Screen>
  );
}

function bridgeErrorCopy(e: unknown): string {
  const record = e as { failure?: string } | null;
  switch (record?.failure) {
    case 'network': return t('bridge.error.network');
    case 'disabled': return t('bridge.error.disabled');
    case 'failed': return t('bridge.error.failed');
    default: return t('bridge.error.unsupported');
  }
}

function bridgeStateCopy(state: string): string {
  switch (state) {
    case 'awaiting-deposit': return t('bridge.state.awaitingDeposit');
    case 'attesting': return t('bridge.state.attesting');
    case 'minted': return t('bridge.state.minted');
    case 'released': return t('bridge.state.released');
    case 'failed': return t('bridge.state.failed');
    default: return t('bridge.state.attesting');
  }
}

function ChainCard({ name, side }: { name: ChainName; side: string }) {
  const c = CHAINS[name];
  return (
    <View className="flex-1 p-3 rounded-[14px]" style={tile(0.04, alpha(c, 0.25))}>
      <Txt className="text-[9px] text-text3 tracking-label">{side.toUpperCase()}</Txt>
      <View className="flex-row items-center gap-2 mt-1.5">
        <ChainGlyph chain={name} />
        <View className="flex-1">
          <Txt className="text-[13px] font-semibold">{name}</Txt>
          <Txt className="text-[9px] text-text3">{t(name === 'Ethereum' ? 'bridge.chain.ethereum' : 'bridge.chain.mintlayer')}</Txt>
        </View>
      </View>
    </View>
  );
}
