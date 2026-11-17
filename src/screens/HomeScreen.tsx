import React, { useState } from 'react';
import type { Nav } from './types';
import { Pressable, ScrollView, View } from 'react-native';
import { t, type I18nKey } from '../i18n';
import { ACTIVITY, ASSETS, BALANCE, NETWORKS, RANGES } from '../data';
import { C, CHAINS, G, alpha, white } from '../theme';
import { AreaChart, Avatar, Callout, Card, ChainBadge, Enter, Float, Icon, IconBtn, IconName, Label, ListRow, LivePill, Screen, Segmented, Sparkline, TokenIcon, Txt, toneColor, tile } from '../ui';

export function HomeScreen({ onOpenSend, onOpenReceive, onOpenSettings, onGoto, deferred, onBackUp, onLock }: Nav) {
  const [hidden, setHidden] = useState(false);
  const [range, setRange] = useState('1D');
  const [tab, setTab] = useState<'Tokens' | 'NFTs' | 'DeFi'>('Tokens');

  const actions: { icon: IconName; labelKey: 'home.actions.send' | 'home.actions.receive' | 'home.actions.swap' | 'home.actions.bridge'; color: string; press?: () => void; locked?: boolean }[] = [
    { icon: 'arrow_up', labelKey: 'home.actions.send', color: C.text0, press: onOpenSend },
    {
      icon: deferred ? 'lock' : 'arrow_dn',
      labelKey: 'home.actions.receive',
      color: deferred ? C.text3 : C.text0,
      press: deferred ? undefined : onOpenReceive,
      locked: deferred,
    },
    { icon: 'swap', labelKey: 'home.actions.swap', color: C.amber, press: () => onGoto?.('swap') },
    { icon: 'bridge', labelKey: 'home.actions.bridge', color: C.violet, press: () => onGoto?.('bridge') },
  ];

  return (
    <Screen>
      <View className="px-5 flex-row items-center justify-between">
        <View className="flex-row items-center gap-2.5">
          <Avatar letter="S" size={32} />
          <View>
            <Label>{t('home.wallet.label')}</Label>
            <Txt className="text-[13px] font-semibold">satoshi.ml ▾</Txt>
          </View>
        </View>
        <View className="flex-row gap-2">
          {onLock && <IconBtn name="lock" label={t('home.lock')} onPress={onLock} />}
          <IconBtn name="settings" label={t('settings.title')} onPress={onOpenSettings} />
          <IconBtn name="bell" label={t('settings.notifications')} badge={C.amber} />
        </View>
      </View>

      {deferred && (
        <View className="px-5 pt-3">
          <Callout
            icon="shield"
            action={
              <Pressable onPress={onBackUp} className="px-3 py-1.5 rounded-[9px]" style={{ backgroundColor: C.amber }}>
                <Txt className="text-[11px] font-bold" style={{ color: '#1a1208' }}>
                  {t('home.backup.cta')}
                </Txt>
              </Pressable>
            }>
            <Txt className="text-[12px] text-text1 leading-[17px]">
              <Txt className="text-[12px] font-bold" style={{ color: C.amber }}>
                {t('home.backup.bannerBold')}
              </Txt>{' '}
              {t('home.backup.banner')}
            </Txt>
          </Callout>
        </View>
      )}

      {/* Balance */}
      <View className="px-5 pt-6">
        <Card grad={G.raised} className="p-6 rounded-[24px]">
          <Float style={{ position: 'absolute', top: -40, right: -40 }} amount={8}>
            <View className="w-[180px] h-[180px] rounded-full" style={{ backgroundColor: alpha(C.amber, 0.18) }} />
          </Float>

          <View className="flex-row items-center gap-2">
            <Label>{t('home.balance.total')}</Label>
            <Pressable onPress={() => setHidden((h) => !h)}>
              <Icon name={hidden ? 'eye_off' : 'eye'} size={14} color={C.text2} />
            </Pressable>
          </View>

          <View className="flex-row items-baseline gap-2 mt-1.5">
            {hidden ? (
              <Txt className="text-[38px] font-bold tracking-tightest">{t('home.balance.hidden')}</Txt>
            ) : (
              <Txt className="text-[38px] font-bold tracking-tightest">
                <Txt className="text-[38px] font-medium text-text2">$</Txt>
                {BALANCE.total}
              </Txt>
            )}
          </View>

          <View className="flex-row items-center gap-2 mt-2">
            <LivePill value={BALANCE.change} />
            <Txt mono className="text-[12px] text-text2">
              {BALANCE.delta}
            </Txt>
          </View>

          <View className="mt-3.5">
            <AreaChart data={BALANCE.spark} />
          </View>

          <View className="flex-row justify-between mt-1">
            {RANGES.map((r) => (
              <Pressable key={r} onPress={() => setRange(r)}>
                <Txt mono className="text-[10px]" style={{ color: r === range ? C.amber : C.text3 }}>
                  {t(`home.ranges.${r}` as I18nKey)}
                </Txt>
              </Pressable>
            ))}
          </View>
        </Card>
      </View>

      {/* Quick actions */}
      <View className="px-5 pt-4 flex-row gap-2">
        {actions.map((a, i) => (
          <Enter key={a.labelKey} delay={i * 80} style={{ flex: 1 }}>
            <Pressable
              onPress={a.press}
              className="py-3.5 rounded-2xl items-center gap-1.5"
              style={[tile(), { opacity: a.locked ? 0.45 : 1 }]}>
              <Icon name={a.icon} size={20} color={a.color} />
              <Txt className="text-[11px] font-medium">{t(a.labelKey)}</Txt>
            </Pressable>
          </Enter>
        ))}
      </View>

      {/* Networks */}
      <View className="pt-5">
        <View className="px-5 flex-row items-center justify-between mb-2.5">
          <Label>{t('home.networks.title')}</Label>
          <Txt mono className="text-[11px] text-text2">
            {t('home.networks.active', { count: NETWORKS.length })}
          </Txt>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
          {NETWORKS.map((n, i) => (
            <Enter key={n} delay={300 + i * 60}>
              <View
                className="flex-row items-center gap-2 px-3 py-2 rounded-xl"
                style={{ backgroundColor: white(0.03), borderWidth: 1, borderColor: C.lineSoft }}>
                <View className="w-2 h-2 rounded-full" style={{ backgroundColor: CHAINS[n] }} />
                <Txt className="text-[12px] font-medium">{n}</Txt>
              </View>
            </Enter>
          ))}
        </ScrollView>
      </View>

      {/* Assets */}
      <View className="px-5 pt-6">
        <View className="flex-row items-center justify-between mb-3">
          <Txt className="text-[14px] font-semibold">{t('home.assets.title')}</Txt>
          <Segmented
            options={['Tokens', 'NFTs', 'DeFi'] as const}
            value={tab}
            onChange={setTab}
            labels={{ Tokens: t('home.tabs.tokens'), NFTs: t('home.tabs.nfts'), DeFi: t('home.tabs.defi') }}
          />
        </View>

        {ASSETS.map((a, i) => (
          <Enter key={a.sym} delay={400 + i * 70}>
            <TokenRow asset={a} />
          </Enter>
        ))}
      </View>

      {/* Activity */}
      <View className="px-5 pt-6">
        <View className="flex-row items-center justify-between mb-3">
          <Txt className="text-[14px] font-semibold">{t('home.activity.title')}</Txt>
          <Txt className="text-[11px] text-text2">{t('common.seeAll')}</Txt>
        </View>
        <Card variant="glass" className="p-1">
          {ACTIVITY.map((r, i) => (
            <ListRow
              key={r.title}
              icon={r.icon}
              iconColor={toneColor(r.tone)}
              label={r.title}
              sub={<Txt mono className="text-[11px] text-text2 mt-0.5">{r.sub}</Txt>}
              divider={i > 0}
              trailing={
                <View className="items-end">
                  <Txt mono className="text-[11px] text-text2">
                    {r.time}
                  </Txt>
                  <Txt className="text-[10px] mt-0.5" style={{ color: r.state.includes('Confirming') ? C.amber : C.text2 }}>
                    {r.state}
                  </Txt>
                </View>
              }
            />
          ))}
        </Card>
      </View>
    </Screen>
  );
}

/** Asset list line: token icon, symbol + chain, sparkline, value + change. */

/* ══ Home ═══════════════════════════════════════════════════ */

function TokenRow({ asset }: { asset: (typeof ASSETS)[number] }) {
  return (
    <View className="flex-row items-center gap-3 py-3">
      <TokenIcon symbol={asset.sym} size={38} />
      <View className="flex-1">
        <View className="flex-row items-center gap-1.5">
          <Txt className="text-[14px] font-semibold">{asset.sym}</Txt>
          <ChainBadge chain={asset.chain} />
        </View>
        <Txt mono className="text-[11px] text-text2 mt-0.5">
          {asset.amt.toLocaleString(undefined, { maximumFractionDigits: 4 })} · ${asset.price.toLocaleString()}
        </Txt>
      </View>
      <Sparkline data={asset.spark} color={asset.change >= 0 ? C.green : C.red} width={48} height={22} />
      <View className="items-end">
        <Txt mono className="text-[14px] font-semibold">
          ${asset.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </Txt>
        <View className="mt-0.5">
          <LivePill value={asset.change} />
        </View>
      </View>
    </View>
  );
}

/* ══ DEX ════════════════════════════════════════════════════ */
