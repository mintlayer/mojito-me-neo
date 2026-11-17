import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, Line, LinearGradient as SvgGrad, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { ASSETS, ASSET_BALANCES, ASSET_SYMBOLS, HTLC_STEPS, SWAP_STATS } from '../data';
import { C, G } from '../theme';
import { AmountRow, Btn, Card, FlowX, Icon, KV, Label, PctButtons, Screen, ScreenIntro, Steps, SuccessScreen, TokenPicker, Txt, gradColors } from '../ui';

export function SwapScreen() {
  const [from, setFrom] = useState({ sym: 'BTC', chain: 'Bitcoin', amt: '0.025', bal: '0.4821' });
  const [to, setTo] = useState({ sym: 'ML', chain: 'Mintlayer', amt: '7012.45', bal: '12,480.50' });
  /** Which panel the picker is editing, or null when closed. */
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const flip = () => {
    setFrom(to);
    setTo(from);
  };

  const pick = (sym: string) => {
    const asset = ASSETS.find((a) => a.sym === sym);
    if (!asset) return;
    const next = { sym: asset.sym, chain: asset.chain, amt: '0', bal: asset.amt.toLocaleString() };
    if (picking === 'from') setFrom(next);
    else setTo(next);
  };

  if (submitted) {
    return (
      <SuccessScreen
        title="Swap initiated"
        summary={`${from.amt} ${from.sym} → ${to.amt} ${to.sym}`}
        description={`The HTLC is locked on ${from.chain}. Settlement completes once the counterparty reveals the preimage.`}
        onDone={() => setSubmitted(false)}
      />
    );
  }

  return (
    <Screen>
      <ScreenIntro title="Atomic Swap" chip="HTLC" tone={C.amber} blurb="Trustless cross-chain swap. No bridge, no custodian." />

      <TokenPicker
        open={picking !== null}
        onClose={() => setPicking(null)}
        symbols={ASSET_SYMBOLS}
        value={picking === 'from' ? from.sym : to.sym}
        balances={ASSET_BALANCES}
        onSelect={pick}
      />

      <View className="px-5 pt-5">
        <SwapPanel label="You send" data={from} onChange={(amt) => setFrom({ ...from, amt })} onPickToken={() => setPicking('from')} />
        <View className="h-2" />
        <SwapPanel label="You receive" data={to} onPickToken={() => setPicking('to')} />

        <Pressable
          onPress={flip}
          className="absolute w-11 h-11 rounded-[14px] items-center justify-center z-10 overflow-hidden"
          style={{ top: '44%', left: '50%', marginLeft: -22, borderWidth: 1, borderColor: C.line }}>
          <LinearGradient colors={gradColors(G.flip)} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
          <Icon name="swap" size={18} color={C.amber} />
        </Pressable>
      </View>

      <View className="px-5 pt-3">
        <Card className="px-3.5 py-2.5 flex-row flex-wrap">
          {SWAP_STATS.map(([k, v], i) => (
            <View key={k} className="w-1/2 py-1">
              <KV k={k} v={v} right={i % 2 === 1} tone={i === 1 ? C.green : i === 3 ? C.amber : C.text0} />
            </View>
          ))}
        </Card>
      </View>

      {/* HTLC protocol */}
      <View className="px-5 pt-5">
        <Label className="mb-3">Swap protocol · HTLC</Label>
        <Card grad={G.raisedAmber} className="p-4">
          <HtlcRail />
          <Steps steps={HTLC_STEPS} />
        </Card>
      </View>

      <View className="px-5 pt-4">
        <Btn tone="primary" onPress={() => setSubmitted(true)}>
          Initiate atomic swap
        </Btn>
      </View>
    </Screen>
  );
}

function SwapPanel({
  label,
  data,
  onChange,
  onPickToken,
}: {
  label: string;
  data: { sym: string; chain: string; amt: string; bal: string };
  onChange?: (v: string) => void;
  onPickToken?: () => void;
}) {
  const usd = (parseFloat(data.amt || '0') * (data.sym === 'BTC' ? 96420 : 0.3438)).toFixed(2);
  return (
    <Card className="p-[18px]">
      <View className="flex-row justify-between items-center">
        <Label>{label}</Label>
        <Txt mono className="text-[11px] text-text2">
          Bal {data.bal} {data.sym}
        </Txt>
      </View>
      <View className="mt-3">
        <AmountRow symbol={data.sym} chain={data.chain} value={data.amt} onChangeText={onChange} onPickToken={onPickToken} />
      </View>
      <View className="flex-row justify-between items-center mt-2">
        <Txt mono className="text-[11px] text-text2">
          ≈ ${usd}
        </Txt>
        {onChange && <PctButtons compact onPick={(f) => onChange(String(parseFloat(data.amt || '0') * (f === 1 ? 2 : f)))} />}
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
 * direction Mintlayer sits on — an unroutable pair like Ethereum -> Arbitrum
 * is therefore unrepresentable rather than merely rejected.
 */
