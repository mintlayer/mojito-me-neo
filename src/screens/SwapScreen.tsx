import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, Line, LinearGradient as SvgGrad, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { t } from '../i18n';
import { useData } from '../data/providers/context';
import { C, G } from '../theme';
import { AmountRow, Btn, Card, FlowX, Icon, KVGrid, Label, PctButtons, Screen, ScreenIntro, Steps, SuccessScreen, TokenPicker, Txt, gradColors, usd } from '../ui';

/** One side of a swap: token, chain, typed amount and provider balance. */
type SwapPanelData = { sym: string; chain: string; amt: string; bal: number };

export function SwapScreen() {
  const assets = useData((d) => d.getAssets());
  const assetBalances = useData((d) => d.getAssetBalances());
  const assetSymbols = useData((d) => d.getAssetSymbols());
  const htlcSteps = useData((d) => d.getHtlcSteps());
  const swapStats = useData((d) => d.getSwapStats());
  /** Panels start null and resolve from provider assets, the same source the picker uses. */
  const [from, setFrom] = useState<SwapPanelData | null>(null);
  const [to, setTo] = useState<SwapPanelData | null>(null);
  /** Which panel the picker is editing, or null when closed. */
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  const [submitted, setSubmitted] = useState(false);
  /** Approx-USD conversion reads provider fixture prices, not screen constants. */
  const priceMap = Object.fromEntries((assets ?? []).map((a) => [a.sym, a.price] as const));

  /** Build a panel from the provider asset row; a fresh pick starts at amount zero. */
  const sideDefaults = (sym: string): SwapPanelData => {
    const asset = assets?.find((a) => a.sym === sym);
    return { sym, chain: asset?.chain ?? '', amt: '0', bal: asset ? asset.amt : 0 };
  };
  const fromPanel = from ?? sideDefaults('BTC');
  const toPanel = to ?? sideDefaults('ML');

  const flip = () => {
    setFrom(toPanel);
    // The receive side has no quote yet, so it never carries a typed amount.
    setTo({ ...fromPanel, amt: '0' });
  };

  const pick = (sym: string) => {
    const asset = assets?.find((a) => a.sym === sym);
    if (!asset) return;
    const next = sideDefaults(asset.sym);
    if (picking === 'from') setFrom(next);
    else setTo(next);
  };

  if (!assets || !assetBalances || !assetSymbols || !htlcSteps || !swapStats) return <Screen />;

  if (submitted) {
    return (
      <SuccessScreen
        title={t('swap.success.title')}
        summary={`${fromPanel.amt} ${fromPanel.sym} → ${toPanel.amt} ${toPanel.sym}`}
        description={t('swap.success.desc', { chain: fromPanel.chain })}
        onDone={() => setSubmitted(false)}
      />
    );
  }

  return (
    <Screen>
      <ScreenIntro title={t('swap.title')} chip={t('swap.chip')} tone={C.amber} blurb={t('swap.blurb')} />

      <TokenPicker
        open={picking !== null}
        onClose={() => setPicking(null)}
        symbols={assetSymbols}
        value={picking === 'from' ? fromPanel.sym : toPanel.sym}
        balances={assetBalances}
        onSelect={pick}
      />

      <View className="px-5 pt-5">
        <SwapPanel label={t('common.youSend')} data={fromPanel} price={priceMap[fromPanel.sym]} onChange={(amt) => setFrom({ ...fromPanel, amt })} onPickToken={() => setPicking('from')} />
        <View className="h-2" />
        <SwapPanel label={t('common.youReceive')} data={toPanel} price={priceMap[toPanel.sym]} onPickToken={() => setPicking('to')} />

        <Pressable
          onPress={flip}
          className="absolute w-11 h-11 rounded-[14px] items-center justify-center z-10 overflow-hidden"
          style={{ top: '44%', left: '50%', marginLeft: -22, borderWidth: 1, borderColor: C.line }}>
          <LinearGradient colors={gradColors(G.flip)} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
          <Icon name="swap" size={18} color={C.amber} />
        </Pressable>
      </View>

      <View className="px-5 pt-3">
        <Card className="px-3.5 py-2.5">
          <KVGrid rows={swapStats} tone={(i) => (i === 1 ? C.green : i === 3 ? C.amber : C.text0)} />
        </Card>
      </View>

      {/* HTLC protocol */}
      <View className="px-5 pt-5">
        <Label className="mb-3">{t('swap.protocol')}</Label>
        <Card grad={G.raisedAmber} className="p-4">
          <HtlcRail />
          <Steps steps={htlcSteps} />
        </Card>
      </View>

      <View className="px-5 pt-4">
        <Btn tone="primary" onPress={() => setSubmitted(true)}>
          {t('swap.cta')}
        </Btn>
      </View>
    </Screen>
  );
}

function SwapPanel({
  label,
  data,
  price = 0,
  onChange,
  onPickToken,
  amountLabel,
}: {
  label: string;
  data: SwapPanelData;
  price?: number;
  onChange?: (v: string) => void;
  onPickToken?: () => void;
  /** Readable name for the panel's amount input. */
  amountLabel?: string;
}) {
  const usdValue = usd(data.amt, price);
  return (
    <Card className="p-[18px]">
      <View className="flex-row justify-between items-center">
        <Label>{label}</Label>
        <Txt mono className="text-[11px] text-text2">
          {t('common.bal', { bal: data.bal.toLocaleString(), sym: data.sym })}
        </Txt>
      </View>
      <View className="mt-3">
        {/* The receive side has no quote until M2 wires rates: show a dash
            instead of mirroring the sent amount. */}
        <AmountRow symbol={data.sym} chain={data.chain} value={onChange ? data.amt : '-'} onChangeText={onChange} onPickToken={onPickToken} accessibilityLabel={amountLabel ?? label} />
      </View>
      <View className="flex-row justify-between items-center mt-2">
        <Txt mono className="text-[11px] text-text2">
          {t('common.approxUsd', { usd: `$${usdValue}` })}
        </Txt>
        {onChange && <PctButtons compact onPick={(f) => onChange(String(data.bal * f))} />}
      </View>
    </Card>
  );
}

/** BTC ⇄ ML rail with a lock badge and packets travelling across it. */

function HtlcRail() {
  return (
    <View className="h-20 mb-3 justify-center">
      <Svg width="100%" height={80} viewBox="0 0 300 80">
        <Defs>
          <SvgGrad id="rail" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={C.amber} />
            <Stop offset="1" stopColor={C.teal} />
          </SvgGrad>
        </Defs>
        <Circle cx={40} cy={40} r={22} fill="none" stroke={C.amber} strokeWidth={1.5} />
        <SvgText x={40} y={46} textAnchor="middle" fontSize={14} fill={C.amber} fontWeight="600">
          ₿
        </SvgText>
        <Circle cx={260} cy={40} r={22} fill="none" stroke={C.teal} strokeWidth={1.5} />
        <SvgText x={260} y={46} textAnchor="middle" fontSize={14} fill={C.teal} fontWeight="600">
          Ⓜ
        </SvgText>
        <Line x1={64} y1={40} x2={236} y2={40} stroke="url(#rail)" strokeWidth={2} strokeDasharray="3 4" opacity={0.6} />
        <Rect x={136} y={26} width={28} height={24} rx={6} fill={C.bg1} stroke={C.amber} strokeWidth={1} />
        <SvgText x={150} y={43} textAnchor="middle" fontSize={11} fill={C.amber}>
          ⚷
        </SvgText>
      </Svg>
      {[0, 800, 1600].map((d) => (
        <View key={d} className="absolute left-[64px] right-[64px] h-1.5 top-[37px]" pointerEvents="none">
          <FlowX track={172} duration={2400} delay={d}>
            <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: C.amber }} />
          </FlowX>
        </View>
      ))}
    </View>
  );
}

/* ══ Bridge ═════════════════════════════════════════════════ */

/**
 * Mojito bridges Mintlayer <-> everything else, so one endpoint is always
 * Mintlayer. Only the counterparty is selectable and the arrow decides which
 * direction Mintlayer sits on, so an unroutable pair like Ethereum -> Arbitrum
 * is therefore unrepresentable rather than merely rejected.
 */
