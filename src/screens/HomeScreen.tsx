import React, { useCallback, useEffect, useState } from 'react';
import type { Nav } from './types';
import { Pressable, ScrollView, View } from 'react-native';
import { t, type I18nKey } from '../i18n';
import { useData, useDataState, useProviders } from '../data/providers/context';
import { dataErrorCopy } from '../data/errors';
import { usePoll } from '../data/polling';
import type { AssetRow, NftRow, PriceRange } from '../data/providers';
import { C, CHAINS, G, alpha, white } from '../theme';
import { AreaChart, Avatar, Btn, Callout, Card, ChainBadge, Chip, Enter, Float, Icon, IconBtn, IconName, Label, ListRow, LivePill, Screen, Segmented, Sparkline, TokenIcon, Txt, toneColor, tile } from '../ui';

// Polling cadence per the M2 spec: balances and activity refresh every 60 s
// while the wallet screen is foregrounded; focus and pull-to-refresh refresh
// immediately; the cycle pauses in background and resumes with one refresh.
const BALANCE_POLL_MS = 60_000;
/** A successful sync older than this shows the stale banner. */
const STALE_AFTER_MS = 180_000;

export function HomeScreen({ onOpenSend, onOpenReceive, onOpenSettings, onGoto, deferred, onBackUp, onLock, active }: Nav) {
  const { mode, price, pricesAreMock } = useProviders();
  const [tick, setTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async (): Promise<void> => {
    setTick((n) => n + 1);
  }, []);
  usePoll(refresh, { intervalMs: BALANCE_POLL_MS, active: active !== false });

  const balance = useDataState((d) => d.getPortfolio(), tick);
  const assets = useDataState((d) => d.getAssets(), tick);
  const activity = useDataState((d) => d.getActivity(20), tick);
  const nfts = useDataState((d) => d.getNfts(), tick);
  const networks = useData((d) => d.getNetworks());
  const ranges = useData((d) => d.getRanges());
  const profile = useData((d) => d.getProfile());
  const [hidden, setHidden] = useState(false);
  const [range, setRange] = useState<PriceRange>('1D');
  const [series, setSeries] = useState<number[] | null>(null);
  const [tab, setTab] = useState<'Tokens' | 'NFTs' | 'DeFi'>('Tokens');

  // The pull-to-refresh spinner stops when the refreshed data lands.
  useEffect(() => {
    setRefreshing(false);
  }, [balance.loadedAt, assets.loadedAt, activity.loadedAt, nfts.loadedAt]);

  useEffect(() => {
    let live = true;
    price.getHistory('PORTFOLIO', range).then((points) => {
      if (live) setSeries(points.map((p) => p.p));
    });
    return () => {
      live = false;
    };
  }, [price, range]);

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

  if (!networks || !ranges || !profile) return <Screen />;

  // One sync banner at a time, most severe first: offline, syncing, stale.
  const offline = [balance, assets, activity].some((state) => state.error !== null);
  const syncing = !offline && balance.data === null && balance.error === null;
  const lastSync = Math.max(balance.loadedAt, assets.loadedAt, activity.loadedAt, nfts.loadedAt);
  const stale = !offline && !syncing && lastSync > 0 && Date.now() - lastSync > STALE_AFTER_MS;
  const staleMinutes = lastSync > 0 ? Math.max(1, Math.round((Date.now() - lastSync) / 60_000)) : 0;
  const showDemoChip = mode === 'mock' || pricesAreMock;

  return (
    <Screen
      refreshing={refreshing}
      refreshTitle={t('home.activity.refresh')}
      onRefresh={() => {
        setRefreshing(true);
        refresh();
      }}>
      <View className="px-5 flex-row items-center justify-between">
        <View className="flex-row items-center gap-2.5">
          <Avatar letter={profile.initial} size={32} />
          <View>
            <Label>{t('home.wallet.label')}</Label>
            <Txt className="text-[13px] font-semibold">{profile.name} ▾</Txt>
          </View>
        </View>
        {showDemoChip && (
          <View className="flex-1 items-start pl-2">
            <Chip dot={false}>{t('home.demoData')}</Chip>
          </View>
        )}
        <View className="flex-row gap-2">
          {onLock && <IconBtn name="lock" label={t('home.lock')} onPress={onLock} />}
          <IconBtn name="settings" label={t('settings.title')} onPress={onOpenSettings} />
          <IconBtn name="bell" label={t('settings.notifications')} badge={C.amber} />
        </View>
      </View>

      {offline && (
        <View className="px-5 pt-3">
          <Callout tone={C.red} icon="flash">
            <Txt className="text-[11.5px] text-text1 leading-[17px]">{t('common.offline')}</Txt>
          </Callout>
        </View>
      )}
      {!offline && syncing && (
        <View className="px-5 pt-3">
          <Callout tone={C.text2} glyph="ⓘ">
            <Txt className="text-[11.5px] text-text1 leading-[17px]">{t('common.syncing')}</Txt>
          </Callout>
        </View>
      )}
      {!offline && !syncing && stale && (
        <View className="px-5 pt-3">
          <Callout tone={C.amber} glyph="ⓘ">
            <Txt className="text-[11.5px] text-text1 leading-[17px]">{t('common.stale', { minutes: staleMinutes })}</Txt>
          </Callout>
        </View>
      )}

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

          {balance.error !== null ? (
            <View>
              <Label>{t('home.balance.total')}</Label>
              <Callout tone={C.red} glyph="!" className="mt-3">
                <Txt className="text-[11.5px] text-text1 leading-[17px]">{t('home.balance.error')}</Txt>
                <Txt className="text-[11px] text-text2 leading-[16px] mt-1">{dataErrorCopy(balance.error)}</Txt>
              </Callout>
              <View className="mt-3">
                <Btn onPress={refresh}>{t('common.retry')}</Btn>
              </View>
            </View>
          ) : balance.data === null ? (
            <View>
              <Label>{t('home.balance.total')}</Label>
              <Txt className="text-[38px] font-bold tracking-tightest text-text3 mt-1.5">······</Txt>
            </View>
          ) : (
            <View>
              <View className="flex-row items-center gap-2">
                <Label>{t('home.balance.total')}</Label>
                <Pressable
                  onPress={() => setHidden((h) => !h)}
                  accessibilityRole="button"
                  accessibilityLabel={t(hidden ? 'home.balance.show' : 'home.balance.hide')}
                  accessibilityState={{ selected: hidden }}>
                  <Icon name={hidden ? 'eye_off' : 'eye'} size={14} color={C.text2} />
                </Pressable>
              </View>

              <View className="flex-row items-baseline gap-2 mt-1.5">
                {hidden ? (
                  // Balance mask is decoration, kept in code rather than en.ts.
                  <Txt className="text-[38px] font-bold tracking-tightest">••••••</Txt>
                ) : (
                  <Txt className="text-[38px] font-bold tracking-tightest">
                    <Txt className="text-[38px] font-medium text-text2">$</Txt>
                    {balance.data.total}
                  </Txt>
                )}
              </View>

              <View className="flex-row items-center gap-2 mt-2">
                <LivePill value={balance.data.change} />
                <Txt mono className="text-[12px] text-text2">
                  {balance.data.delta}
                </Txt>
              </View>

              <View className="mt-3.5">
                {/* Provider history for the picked range; the fixture spark is
                    only the fallback while it resolves. */}
                <AreaChart data={series ?? balance.data.spark} />
              </View>

              <View className="flex-row justify-between mt-1">
                {ranges.map((r) => (
                  <Pressable key={r} onPress={() => setRange(r)}>
                    <Txt mono className="text-[10px]" style={{ color: r === range ? C.amber : C.text3 }}>
                      {t(`home.ranges.${r}` as I18nKey)}
                    </Txt>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </Card>
      </View>

      {/* Quick actions */}
      <View className="px-5 pt-4 flex-row gap-2">
        {actions.map((a, i) => (
          <Enter key={a.labelKey} delay={i * 80} style={{ flex: 1 }}>
            <Pressable
              onPress={a.press}
              accessibilityRole="button"
              accessibilityLabel={t(a.labelKey)}
              accessibilityHint={a.locked ? t('home.backup.banner') : undefined}
              accessibilityState={a.locked ? { disabled: true } : undefined}
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
            {t('home.networks.active', { count: networks.length })}
          </Txt>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
          {networks.map((n, i) => (
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

        {tab === 'NFTs' ? (
          <NftList nfts={nfts.data} />
        ) : (
          (assets.data ?? []).map((a, i) => (
            <Enter key={a.sym} delay={400 + i * 70}>
              <TokenRow asset={a} />
            </Enter>
          ))
        )}
      </View>

      {/* Activity */}
      <View className="px-5 pt-6">
        <View className="flex-row items-center justify-between mb-3">
          <Txt className="text-[14px] font-semibold">{t('home.activity.title')}</Txt>
          <Txt className="text-[11px] text-text2">{t('common.seeAll')}</Txt>
        </View>
        {activity.data !== null && activity.data.length === 0 ? (
          <Card variant="glass" className="p-4">
            <Txt className="text-[12px] text-text2 text-center leading-[17px]">{t('home.activity.empty')}</Txt>
          </Card>
        ) : (
          <Card variant="glass" className="p-1">
            {(activity.data ?? []).map((r, i) => (
              <ListRow
                key={`${r.title}-${r.time}-${i}`}
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
                    <Txt className="text-[10px] mt-0.5" style={{ color: r.live ? C.amber : C.text2 }}>
                      {r.state}
                    </Txt>
                  </View>
                }
              />
            ))}
          </Card>
        )}
      </View>
    </Screen>
  );
}

/** NFTs tab: holdings from NftService (real) or the empty gallery. */
function NftList({ nfts }: { nfts: NftRow[] | null }) {
  if (nfts === null) return null;
  if (nfts.length === 0) {
    return (
      <Card variant="glass" className="p-4">
        <Txt className="text-[12px] text-text2 text-center leading-[17px]">{t('home.nfts.empty')}</Txt>
      </Card>
    );
  }
  return (
    <Card variant="glass" className="p-1">
      {nfts.map((nft, i) => (
        <ListRow
          key={nft.id}
          icon="card"
          iconColor={C.violet}
          label={nft.name ?? t('home.tokens.unknown')}
          sub={
            <Txt className="text-[11px] text-text2 mt-0.5">
              {nft.ticker !== null ? t('tokens.nft.collection', { collection: nft.ticker }) : t('tokens.nft.metadataMissing')}
            </Txt>
          }
          divider={i > 0}
          trailing={
            nft.owner !== null ? (
              <Txt mono className="text-[10px] text-text2">
                {t('tokens.nft.owner', { owner: shortId(nft.owner) })}
              </Txt>
            ) : undefined
          }
        />
      ))}
    </Card>
  );
}

/** First 10 and last 6 chars with an ellipsis for owner rows. */
function shortId(id: string): string {
  return id.length <= 18 ? id : `${id.slice(0, 10)}…${id.slice(-6)}`;
}

/* ══ Home ═══════════════════════════════════════════════════ */

/** Asset list line: token icon, symbol + chain, sparkline, value + change. */
function TokenRow({ asset }: { asset: AssetRow }) {
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
