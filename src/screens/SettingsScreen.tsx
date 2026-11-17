import React, { useState } from 'react';
import type { Sheet } from './types';
import Constants from 'expo-constants';
import { Alert, Linking, Pressable, View } from 'react-native';
import { t, type I18nKey } from '../i18n';
import { useData } from '../data/providers/context';
import { C, G } from '../theme';
import { Avatar, Card, ListRow, PickerSheet, Screen, Section, SheetHeader, Toggle, Txt, tint, tile } from '../ui';

type SettingsNav = Sheet & {
  /** Re-enters the seed/verify flow. */
  onBackup?: () => void;
  onChangePin?: () => void;
  onLock?: () => void;
};

export function SettingsScreen({ onClose, onBackup, onChangePin, onLock }: SettingsNav) {
  const profile = useData((d) => d.getProfile());
  const networks = useData((d) => d.getNetworks());
  const dapps = useData((d) => d.getDapps());
  const [flags, setFlags] = useState({ biometric: true, autoLock: true, testnet: false, notifs: true, hideBal: false });
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>('USD');
  const [appearance, setAppearance] = useState<AppearanceId>('dark');
  const [dex, setDex] = useState<DexId>('mintlayer');
  const [sheet, setSheet] = useState<'currency' | 'appearance' | 'dex' | null>(null);
  const set = (k: keyof typeof flags) => (v: boolean) => setFlags((f) => ({ ...f, [k]: v }));

  // Self-custody: signing out destroys local state, so the phrase is the only
  // way back. Confirm destructively rather than on a single tap.
  const confirmSignOut = () =>
    Alert.alert(
      t('settings.signout.title'),
      t('settings.signout.body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('settings.signout.cta'), style: 'destructive', onPress: () => onLock?.() },
      ],
    );

  if (!profile || !networks || !dapps) return <Screen />;

  return (
    <Screen>
      <SheetHeader title={t('settings.title')} onClose={onClose} />

      {/* Profile */}
      <View className="px-5 pt-3">
        <Card grad={G.raised} className="p-4 rounded-[18px] flex-row items-center gap-3">
          <Avatar letter={profile.initial} size={48} radius={14} colors={G.avatar} />
          <View className="flex-1">
            <Txt className="text-[14px] font-semibold">{profile.name}</Txt>
            <Txt mono className="text-[11px] text-text2">
              {profile.address} · {profile.chains} chains
            </Txt>
          </View>
          <Pressable className="px-2.5 py-1.5 rounded-lg" style={tile(0.05, C.line)}>
            <Txt className="text-[11px] font-medium text-text1">{t('settings.edit')}</Txt>
          </Pressable>
        </Card>
      </View>

      <Section title={t('settings.section.security')}>
        <ListRow icon="fingerprint" iconColor={C.amber} label={t('settings.security.biometrics')} sub={t('settings.security.biometricsSub')}>
          <Toggle on={flags.biometric} onChange={set('biometric')} />
        </ListRow>
        <ListRow icon="lock" label={t('settings.security.autolock')} sub={t('settings.security.autolockSub')} divider>
          <Toggle on={flags.autoLock} onChange={set('autoLock')} />
        </ListRow>
        <ListRow icon="shield" iconColor={C.green} label={t('settings.backup.reveal')} sub={t('settings.backup.revealSub')} trailing="→" divider onPress={onBackup} />
        <ListRow icon="lock" label={t('settings.changePin')} trailing="→" divider onPress={onChangePin} />
        <ListRow icon="history" label={t('settings.dapps')} sub={t('settings.dappsSub', { count: dapps.active })} trailing="→" divider />
      </Section>

      <Section title={t('settings.section.networks')}>
        <ListRow icon="bridge" iconColor={C.violet} label={t('settings.networks.manage')} sub={t('settings.networks.manageSub', { count: networks.length })} trailing="→" />
        <ListRow icon="flash" iconColor={C.amber} label={t('settings.network.testnet')} sub={t('settings.network.testnetSub')} divider>
          <Toggle on={flags.testnet} onChange={set('testnet')} />
        </ListRow>
        <ListRow icon="chart" iconColor={C.teal} label={t('settings.dex')} sub={t(dex === 'mintlayer' ? 'settings.dexes.mintlayer' : 'settings.dexes.auto')} trailing="→" divider onPress={() => setSheet('dex')} />
      </Section>

      <Section title={t('settings.section.preferences')}>
        <ListRow icon="eye" label={t('settings.display.hideBalances')} sub={t('settings.display.hideBalancesSub')}>
          <Toggle on={flags.hideBal} onChange={set('hideBal')} />
        </ListRow>
        <ListRow icon="bell" iconColor={C.amber} label={t('settings.notifications')} sub={t('settings.notificationsSub')} divider>
          <Toggle on={flags.notifs} onChange={set('notifs')} />
        </ListRow>
        <ListRow icon="settings" label={t('settings.currency')} sub={currency} trailing="→" divider onPress={() => setSheet('currency')} />
        <ListRow
          icon="settings"
          label={t('settings.appearance')}
          sub={t(APPEARANCE_LABEL_KEYS[appearance])}
          trailing="→"
          divider
          onPress={() => setSheet('appearance')}
        />
      </Section>

      <Section title={t('settings.section.support')}>
        <ListRow icon="shield" label={t('settings.support.help')} trailing="→" onPress={() => Linking.openURL('https://mintlayer.org/support')} />
        <ListRow icon="bell" label={t('settings.support.contact')} trailing="→" divider onPress={() => Linking.openURL('mailto:support@mintlayer.org')} />
        <ListRow icon="settings" label={t('settings.support.terms')} trailing="→" divider onPress={() => Linking.openURL('https://mintlayer.org/terms')} />
      </Section>

      <View className="px-5 pt-4">
        <Pressable
          onPress={confirmSignOut}
          className="py-3.5 rounded-[14px] items-center"
          style={tint(C.red, 0.08)}>
          <Txt className="text-[14px] font-semibold" style={{ color: C.red }}>
            {t('settings.signout.cta')}
          </Txt>
        </Pressable>
      </View>

      <Txt mono className="text-[10px] text-text3 text-center pt-4">
        {t('settings.version', { version: Constants.nativeApplicationVersion ?? 'dev', build: Constants.nativeBuildVersion ?? '-' })}
      </Txt>

      <PickerSheet
        open={sheet === 'currency'}
        onClose={() => setSheet(null)}
        title={t('settings.currency')}
        options={CURRENCIES}
        value={currency}
        onSelect={setCurrency}
      />
      <PickerSheet
        open={sheet === 'appearance'}
        onClose={() => setSheet(null)}
        title={t('settings.appearance')}
        options={APPEARANCES}
        value={appearance}
        onSelect={setAppearance}
        labels={{ dark: t('settings.appearance.dark'), light: t('settings.appearance.light'), system: t('settings.appearance.system') }}
      />
      <PickerSheet
        open={sheet === 'dex'}
        onClose={() => setSheet(null)}
        title={t('settings.dex')}
        options={DEXES}
        value={dex}
        onSelect={setDex}
        labels={{ mintlayer: t('settings.dexes.mintlayer'), auto: t('settings.dexes.auto') }}
      />
    </Screen>
  );
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'BTC'] as const;

// Selectable values stay internal ids; the display copy comes from i18n.
type AppearanceId = 'dark' | 'light' | 'system';
const APPEARANCES: readonly AppearanceId[] = ['dark', 'light', 'system'];

const APPEARANCE_LABEL_KEYS: Record<AppearanceId, I18nKey> = {
  dark: 'settings.appearance.dark',
  light: 'settings.appearance.light',
  system: 'settings.appearance.system',
};

type DexId = 'mintlayer' | 'auto';
const DEXES: readonly DexId[] = ['mintlayer', 'auto'];

