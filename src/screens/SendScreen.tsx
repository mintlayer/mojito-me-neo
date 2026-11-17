import React, { useState } from 'react';
import type { Sheet } from './types';
import { Linking, Pressable, ScrollView, TextInput, View } from 'react-native';
import { t, type I18nKey } from '../i18n';
import { useData } from '../data/providers/context';
import type { FeeTierId } from '../data/providers';
import { C, G } from '../theme';
import { Avatar, Btn, Callout, Card, ChainBadge, Icon, KVRow, Label, PctButtons, Screen, SheetHeader, SuccessScreen, TokenIcon, TokenPicker, Txt, tint, tile, hairlineTop } from '../ui';

export function SendScreen({ onClose }: Sheet) {
  const assets = useData((d) => d.getAssets());
  const assetBalances = useData((d) => d.getAssetBalances());
  const assetSymbols = useData((d) => d.getAssetSymbols());
  const contacts = useData((d) => d.getContacts());
  const fees = useData((d) => d.getFees());
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [tokenSym, setTokenSym] = useState('ML');
  const [picker, setPicker] = useState(false);
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [feeTier, setFeeTier] = useState<FeeTierId>('standard');
  const token = assets?.find((a) => a.sym === tokenSym) ?? assets?.[0];

  if (!assets || !assetBalances || !assetSymbols || !contacts || !fees || !token) return <Screen />;
  const fee = fees[feeTier];

  if (step === 2) {
    return (
      <SuccessScreen
        title={t('send.step.sent')}
        summary={`${amount} ${token.sym} → ${address.slice(0, 10)}…`}
        onDone={onClose}
        header={<SheetHeader onClose={onClose} />}
        secondary={
          <Btn
            tone="ghost"
            className="w-full mt-1"
            onPress={() => Linking.openURL('https://explorer.mintlayer.org/tx/0x4f2ab91c')}>
            {t('common.seeExplorer')}
          </Btn>
        }>
        <Card className="w-full mt-6 p-3.5 rounded-[14px] gap-2">
          <KVRow k={t('send.txHash')} v="0x4f2a…b91c" tone={C.text1} />
          <KVRow k={t('send.status')} v={t('send.statusConfirming')} tone={C.amber} />
        </Card>
      </SuccessScreen>
    );
  }

  if (step === 1) {
    const usd = (parseFloat(amount || '0') * token.price).toFixed(2);
    const rows: [string, React.ReactNode][] = [
      [t('send.to.label'), <Txt key="to" mono className="text-[12px]">{address}</Txt>],
      [t('send.network'), <ChainBadge key="net" chain={token.chain} />],
      [t('common.networkFee'), `${fee.cost} ${token.sym} · ~$0.00`],
      [t('send.arrival'), <Txt key="eta" className="text-[12px]" style={{ color: C.amber }}>{t(`send.fee.eta.${feeTier}` as I18nKey)}</Txt>],
      [t('common.total'), `${(parseFloat(amount || '0') + fee.cost).toFixed(5)} ${token.sym}`],
    ];
    return (
      <Screen>
        <SheetHeader title={t('send.step.review')} onClose={onClose} onBack={() => setStep(0)} />
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
              {t('common.approxUsd', { usd: `$${usd}` })}
            </Txt>
          </View>

          <Card className="p-3.5 rounded-[14px]">
            {rows.map(([k, v], i) => (
              <View key={k} className="py-2.5" style={i > 0 ? hairlineTop : undefined}>
                <KVRow k={k} v={v} tone={C.text0} />
              </View>
            ))}
          </Card>

          <Callout icon="fingerprint" className="mt-3.5">
            <Txt className="text-[12px]">{t('send.authBio', { bio: t('onboarding.bio.face') })}</Txt>
          </Callout>

          <Btn tone="primary" icon="lock" className="mt-4" onPress={() => setStep(2)}>
            {t('send.confirm', { amount, token: token.sym })}
          </Btn>
        </View>
      </Screen>
    );
  }

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
          }
        }}
      />

      {/* Amount */}
      <View className="px-6 pt-5 items-center">
        <View className="flex-row items-baseline gap-1.5">
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="0"
            placeholderTextColor={C.text3}
            keyboardType="decimal-pad"
            accessibilityLabel={t('send.amount.a11y')}
            className="font-mono text-[56px] font-bold text-text0 text-center p-0 min-w-[80px]"
          />
          <Txt className="text-[20px] text-text2 font-medium">{token.sym}</Txt>
        </View>
        <Txt mono className="text-[13px] text-text2 mt-1">
          {t('send.usd', { usd: (parseFloat(amount || '0') * token.price).toFixed(2) })}
        </Txt>
        <View className="w-full mt-3.5">
          <PctButtons onPick={(f) => setAmount(String(token.amt * f))} />
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
            onChangeText={setAddress}
            placeholder={t('send.address.placeholder')}
            placeholderTextColor={C.text3}
            autoCapitalize="none"
            accessibilityLabel={t('send.address.a11y')}
            className="flex-1 font-mono text-[13px] text-text0 p-0"
          />
          <Icon name="scan" size={18} color={C.amber} />
          <Icon name="qr" size={18} color={C.text2} />
        </Card>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 10 }}>
          {contacts.map((c) => (
            <Pressable
              key={c.name}
              onPress={() => setAddress(c.address)}
              className="flex-row items-center gap-2 px-3 py-2 rounded-full"
              style={tile()}>
              <Avatar letter={c.name[0]} size={22} radius={11} colors={G.avatar} />
              <Txt className="text-[12px] font-medium">{c.name}</Txt>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Fee tier */}
      <View className="px-6 pt-5">
        <Label className="mb-2">{t('common.networkFee')}</Label>
        <View className="flex-row gap-1.5">
          {(Object.keys(fees) as FeeTierId[]).map((k) => {
            const on = feeTier === k;
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
                  {t(`send.fee.eta.${k}` as I18nKey)}
                </Txt>
                <Txt mono className="text-[10px] text-text3 mt-0.5">
                  {fees[k].cost} {token.sym}
                </Txt>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View className="px-6 pt-6">
        <Btn tone="primary" disabled={!amount || !address} onPress={() => setStep(1)}>
          {t('send.review.cta')}
        </Btn>
      </View>
    </Screen>
  );
}

/* ══ Receive ════════════════════════════════════════════════ */

/* ══ Send ═══════════════════════════════════════════════════ */
