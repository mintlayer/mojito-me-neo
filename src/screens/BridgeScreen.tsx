import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Defs, LinearGradient as SvgGrad, Path, Stop } from 'react-native-svg';
import { t } from '../i18n';
import { useData } from '../data/providers/context';
import { C, CHAINS, G, alpha } from '../theme';
import type { ChainName } from '../theme';
import { AmountRow, Btn, Card, ChainGlyph, FlowX, Icon, KVGrid, Label, ListRow, PickerSheet, Screen, ScreenIntro, SuccessScreen, TokenPicker, Txt, hairlineTop, tile } from '../ui';

export function BridgeScreen() {
  const assets = useData((d) => d.getAssets());
  const assetBalances = useData((d) => d.getAssetBalances());
  const assetSymbols = useData((d) => d.getAssetSymbols());
  const bridgeChains = useData((d) => d.getBridgeChains());
  const bridgeQuote = useData((d) => d.getBridgeQuote());
  const bridgeRoute = useData((d) => d.getBridgeRoute());
  const [src, setSrc] = useState<ChainName>('Mintlayer');
  const [dst, setDst] = useState<ChainName>('Arbitrum');
  const [amount, setAmount] = useState('500.00');
  const [token, setToken] = useState('USDT');
  const [chainPicker, setChainPicker] = useState(false);
  const [tokenPicker, setTokenPicker] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // The picked chain always lands on whichever side isn't Mintlayer.
  const pickChain = (name: ChainName) => (src === HOME_CHAIN ? setDst(name) : setSrc(name));

  if (!assets || !assetBalances || !assetSymbols || !bridgeChains || !bridgeQuote || !bridgeRoute) return <Screen />;
  const counterpartyChains = bridgeChains.map((c) => c.name).filter((n) => n !== HOME_CHAIN);
  // Same source the token picker uses, so the caption cannot drift from it.
  const tokenBalance = assets.find((a) => a.sym === token)?.amt ?? 0;

  if (submitted) {
    return (
      <SuccessScreen
        title={t('bridge.success.title')}
        tone={C.violet}
        btnTone="violet"
        summary={`${amount} ${token} · ${src} → ${dst}`}
        description={t('bridge.success.desc', { src, dst })}
        onDone={() => setSubmitted(false)}
      />
    );
  }

  return (
    <Screen>
      <ScreenIntro title={t('bridge.title')} chip={t('bridge.chip')} tone={C.violet} blurb={t('bridge.blurb')} />

      <PickerSheet
        open={chainPicker}
        onClose={() => setChainPicker(false)}
        title={src === HOME_CHAIN ? t('bridge.to') : t('bridge.from')}
        options={counterpartyChains}
        value={src === HOME_CHAIN ? dst : src}
        onSelect={pickChain}
        renderLeading={(n) => <ChainGlyph chain={n} size={28} />}
        subtitleFor={(n) => bridgeChains.find((c) => c.name === n)?.sym}
      />

      <TokenPicker
        open={tokenPicker}
        onClose={() => setTokenPicker(false)}
        symbols={assetSymbols}
        value={token}
        balances={assetBalances}
        onSelect={setToken}
      />

      {/* Tunnel */}
      <View className="px-5 pt-6">
        <Card grad={G.raisedViolet} className="px-5 py-7 rounded-[22px]">
          <View className="flex-row items-center gap-3">
            <ChainCard name={src} sym={bridgeChains.find((c) => c.name === src)?.sym ?? src} side={t('bridge.sideFrom')} onPress={src === HOME_CHAIN ? undefined : () => setChainPicker(true)} />
            <Pressable
              onPress={() => {
                setSrc(dst);
                setDst(src);
              }}
              accessibilityRole="button"
              accessibilityLabel={t('bridge.swapSides')}
              className="w-9 h-9 rounded-xl items-center justify-center"
              style={{ backgroundColor: C.bg1, borderWidth: 1, borderColor: C.line }}>
              <Icon name="swap" size={14} color={C.violet} />
            </Pressable>
            <ChainCard name={dst} sym={bridgeChains.find((c) => c.name === dst)?.sym ?? dst} side={t('bridge.sideTo')} onPress={dst === HOME_CHAIN ? undefined : () => setChainPicker(true)} />
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
          <AmountRow symbol={token} value={amount} onChangeText={setAmount} onPickToken={() => setTokenPicker(true)} />
        </Card>
      </View>

      {/* Route */}
      <View className="px-5 pt-4">
        <Label className="mb-2">{t('bridge.route')}</Label>
        <Card className="p-3.5 rounded-2xl">
          {bridgeRoute.map((r, i) => (
            <ListRow
              key={r.label}
              icon={r.icon}
              iconColor={C.violet}
              label={<Txt className="text-[12px] font-medium">{r.label}</Txt>}
              sub={
                <Txt mono className="text-[10px] text-text3 mt-0.5">
                  {r.detail}
                </Txt>
              }
              trailing={
                <Txt mono className="text-[10px] text-text2">
                  {r.eta}
                </Txt>
              }
              connector={i < bridgeRoute.length - 1}
              compact
            />
          ))}
          <View className="mt-2.5 pt-2.5" style={hairlineTop}>
            <KVGrid rows={bridgeQuote} tone={(i) => (i === 1 ? C.violet : C.text0)} />
          </View>
        </Card>
      </View>

      <View className="px-5 pt-4">
        <Btn tone="violet" icon="bridge" onPress={() => setSubmitted(true)}>
          {t('bridge.cta', { amount, token, chain: dst })}
        </Btn>
      </View>
    </Screen>
  );
}

const HOME_CHAIN = 'Mintlayer';

function ChainCard({ name, sym, side, onPress }: { name: ChainName; sym: string; side: string; onPress?: () => void }) {
  const c = CHAINS[name];
  return (
    <Pressable onPress={onPress} className="flex-1 p-3 rounded-[14px]" style={tile(0.04, alpha(c, 0.25))}>
      <Txt className="text-[9px] text-text3 tracking-label">{side.toUpperCase()}</Txt>
      <View className="flex-row items-center gap-2 mt-1.5">
        <ChainGlyph chain={name} />
        <View className="flex-1">
          <Txt className="text-[13px] font-semibold">{name}</Txt>
          <Txt className="text-[9px] text-text3">{sym}</Txt>
        </View>
        {onPress && <Icon name="chevron_r" size={13} color={C.text3} />}
      </View>
    </Pressable>
  );
}

/* ══ Card ═══════════════════════════════════════════════════ */
