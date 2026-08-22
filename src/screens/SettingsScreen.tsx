import React, { useState } from 'react';
import type { Sheet } from './types';
import { Alert, Linking, Pressable, View } from 'react-native';
import { PROFILE } from '../data';
import { C, G, alpha, white } from '../theme';
import { Avatar, Card, ListRow, PickerSheet, Screen, Section, SheetHeader, Toggle, Txt } from '../ui';

type SettingsNav = Sheet & {
  /** Re-enters the seed/verify flow. */
  onBackup?: () => void;
  onChangePin?: () => void;
  onLock?: () => void;
};

export function SettingsScreen({ onClose, onBackup, onChangePin, onLock }: SettingsNav) {
  const [flags, setFlags] = useState({ biometric: true, autoLock: true, testnet: false, notifs: true, hideBal: false });
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>('USD');
  const [appearance, setAppearance] = useState<(typeof APPEARANCES)[number]>('Dark');
  const [dex, setDex] = useState<(typeof DEXES)[number]>('Mintlayer onchain');
  const [sheet, setSheet] = useState<'currency' | 'appearance' | 'dex' | null>(null);
  const set = (k: keyof typeof flags) => (v: boolean) => setFlags((f) => ({ ...f, [k]: v }));

  // Self-custody: signing out destroys local state, so the phrase is the only
  // way back. Confirm destructively rather than on a single tap.
  const confirmSignOut = () =>
    Alert.alert(
      'Sign out of this wallet?',
      'This device forgets your keys. You can only get back in with your 24-word recovery phrase — make sure you have it written down.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => onLock?.() },
      ],
    );

  return (
    <Screen>
      <SheetHeader title="Settings" onClose={onClose} />

      {/* Profile */}
      <View className="px-5 pt-3">
        <Card grad={G.raised} className="p-4 rounded-[18px] flex-row items-center gap-3">
          <Avatar letter={PROFILE.initial} size={48} radius={14} colors={G.avatar} />
          <View className="flex-1">
            <Txt className="text-[14px] font-semibold">{PROFILE.name}</Txt>
            <Txt mono className="text-[11px] text-text2">
              {PROFILE.address} · {PROFILE.chains} chains
            </Txt>
          </View>
          <Pressable className="px-2.5 py-1.5 rounded-lg" style={{ backgroundColor: white(0.05), borderWidth: 1, borderColor: C.line }}>
            <Txt className="text-[11px] font-medium text-text1">Edit</Txt>
          </Pressable>
        </Card>
      </View>

      <Section title="Security">
        <ListRow icon="fingerprint" iconColor={C.amber} label="Face ID" sub="Unlock + sign transactions">
          <Toggle on={flags.biometric} onChange={set('biometric')} />
        </ListRow>
        <ListRow icon="lock" label="Auto-lock" sub="After 1 minute of inactivity" divider>
          <Toggle on={flags.autoLock} onChange={set('autoLock')} />
        </ListRow>
        <ListRow icon="shield" iconColor={C.green} label="Recovery phrase" sub="Back up your 24 words" trailing="→" divider onPress={onBackup} />
        <ListRow icon="lock" label="Change PIN" trailing="→" divider onPress={onChangePin} />
        <ListRow icon="history" label="Connected dApps" sub="3 active sessions" trailing="→" divider />
      </Section>

      <Section title="Networks">
        <ListRow icon="bridge" iconColor={C.violet} label="Manage networks" sub="5 enabled · Add custom RPC" trailing="→" />
        <ListRow icon="flash" iconColor={C.amber} label="Testnet mode" sub="Show test networks" divider>
          <Toggle on={flags.testnet} onChange={set('testnet')} />
        </ListRow>
        <ListRow icon="chart" iconColor={C.teal} label="Default DEX" sub={dex} trailing="→" divider onPress={() => setSheet('dex')} />
      </Section>

      <Section title="Preferences">
        <ListRow icon="eye" label="Hide balances" sub="Until you tap to reveal">
          <Toggle on={flags.hideBal} onChange={set('hideBal')} />
        </ListRow>
        <ListRow icon="bell" iconColor={C.amber} label="Notifications" sub="Transactions, price alerts" divider>
          <Toggle on={flags.notifs} onChange={set('notifs')} />
        </ListRow>
        <ListRow icon="settings" label="Display currency" sub={currency} trailing="→" divider onPress={() => setSheet('currency')} />
        <ListRow icon="settings" label="Appearance" sub={appearance} trailing="→" divider onPress={() => setSheet('appearance')} />
      </Section>

      <Section title="Support">
        <ListRow icon="shield" label="Help center" trailing="→" onPress={() => Linking.openURL('https://mintlayer.org/support')} />
        <ListRow icon="bell" label="Contact us" trailing="→" divider onPress={() => Linking.openURL('mailto:support@mintlayer.org')} />
        <ListRow icon="settings" label="Terms & privacy" trailing="→" divider onPress={() => Linking.openURL('https://mintlayer.org/terms')} />
      </Section>

      <View className="px-5 pt-4">
        <Pressable
          onPress={confirmSignOut}
          className="py-3.5 rounded-[14px] items-center"
          style={{ backgroundColor: alpha(C.red, 0.08), borderWidth: 1, borderColor: alpha(C.red, 0.25) }}>
          <Txt className="text-[14px] font-semibold" style={{ color: C.red }}>
            Sign out
          </Txt>
        </Pressable>
      </View>

      <Txt mono className="text-[10px] text-text3 text-center pt-4">
        mojito · v2.4.1 · build 8821
      </Txt>

      <PickerSheet
        open={sheet === 'currency'}
        onClose={() => setSheet(null)}
        title="Display currency"
        options={CURRENCIES}
        value={currency}
        onSelect={setCurrency}
      />
      <PickerSheet
        open={sheet === 'appearance'}
        onClose={() => setSheet(null)}
        title="Appearance"
        options={APPEARANCES}
        value={appearance}
        onSelect={setAppearance}
      />
      <PickerSheet
        open={sheet === 'dex'}
        onClose={() => setSheet(null)}
        title="Default DEX"
        options={DEXES}
        value={dex}
        onSelect={setDex}
      />
    </Screen>
  );
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'BTC'] as const;

const APPEARANCES = ['Dark', 'Light', 'System'] as const;

const DEXES = ['Mintlayer onchain', 'Auto-route'] as const;

