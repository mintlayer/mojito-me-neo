import React, { useEffect, useState } from 'react';
import type { Sheet } from './types';
import Constants from 'expo-constants';
import { Alert, Linking, Pressable, View } from 'react-native';
import { t } from '../i18n';
import { useData, useProviders } from '../data/providers/context';
import type { WaitlistMemberStatus } from '../data/providers';
import { maskEmail } from '../waitlist/WaitlistForm';
import { loadAppSettings, saveAppSettings } from '../storage/appSettings';
import { Keypad, PinDots, pinEntryCheck, usePinEntry } from '../onboarding/ui';
import { detectBio } from '../onboarding/ui/useBioScan';
import { C, G } from '../theme';
import { Avatar, Btn, Card, ListRow, PickerSheet, Screen, Section, SheetHeader, Toggle, Txt, tint } from '../ui';

export function SettingsScreen({ onClose, onBackup, onChangePin, onLock, onSignOut, wordCount, network, onNetworkChange }: Sheet) {
  const providers = useProviders();
  const profile = useData((d) => d.getProfile());
  const networks = useData((d) => d.getNetworks());
  // Waitlist membership (M5, R4 local-only): the row exists only while the
  // device holds its slot, and leave() is the local wipe that keeps the
  // email persistence user-controlled. The email renders masked only.
  const [waitlist, setWaitlist] = useState<WaitlistMemberStatus | null>(null);
  // Security toggles are persisted (storage/appSettings); the other flags
  // stay local until their features ship. The network switch is app-level
  // (ProvidersProvider rebuilds on change), not a local flag.
  const [security, setSecurity] = useState({ biometric: true, autoLock: true });
  const [flags, setFlags] = useState({ notifs: true, hideBal: false });
  const [dex, setDex] = useState<DexId>('mintlayer');
  // Currency and Appearance have no backend in M2: their rows render the
  // USD/dark defaults as coming-soon status instead of opening silent no-op
  // pickers.
  const [sheet, setSheet] = useState<'dex' | null>(null);
  /** Which security control is waiting for its disable step-up. */
  const [confirm, setConfirm] = useState<'biometric' | 'autoLock' | null>(null);
  /** Device biometric capability; null until the probe lands. The enable
   *  path must never write biometrics:true on hardware that cannot honor
   *  it: the vault key would seal behind a prompt that can never succeed. */
  const [bioAvailable, setBioAvailable] = useState<boolean | null>(null);
  const set = (k: keyof typeof flags) => (v: boolean) => setFlags((f) => ({ ...f, [k]: v }));

  // Load the persisted toggles once; every change writes straight through.
  useEffect(() => {
    let alive = true;
    void loadAppSettings()
      .then((s) => {
        if (alive) setSecurity({ biometric: s.biometrics ?? true, autoLock: s.autoLock });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // Same probe the Secure screen uses: no hardware, nothing enrolled.
  useEffect(() => {
    let alive = true;
    void detectBio().then((bio) => {
      if (alive) setBioAvailable(bio !== null);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Waitlist status read once; refreshed locally after a leave (the wipe is
  // the only state change this screen can cause). The HTTP provider refuses
  // status typed until the backend adds a member-status route, so the row
  // simply stays hidden instead of claiming a state it cannot know.
  useEffect(() => {
    let alive = true;
    void providers.waitlist
      .status()
      .then((s) => {
        if (alive) setWaitlist(s);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [providers.waitlist]);

  // Destructive confirm, same pattern as sign-out: the wipe discards the
  // sealed email and the waitlist spot on this device.
  const confirmLeaveWaitlist = () =>
    Alert.alert(
      t('settings.waitlist.leave.confirm.title'),
      t('settings.waitlist.leave.confirm.body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.waitlist.leave'),
          style: 'destructive',
          onPress: () => {
            void providers.waitlist
              .leave()
              .then(() => setWaitlist({ joined: false, email: null, position: null }))
              .catch(() => undefined);
          },
        },
      ],
    );

  /** Persist a toggle change. Disabling a security control is a step-up
   *  boundary: someone holding the unlocked phone must not be able to
   *  switch auto-lock or biometrics off without proving knowledge of the
   *  PIN. Enabling needs no step-up; it only adds a control, but enabling
   *  biometrics on biometrics-less hardware is refused: the persisted true
   *  would gate the vault key on a prompt that can never succeed and brick
   *  the wallet at the next cold start. While the probe is still running
   *  (bioAvailable null) an enable tap is swallowed too; the probe resolves
   *  in milliseconds and the switch is disabled meanwhile. */
  const applySecurityFlag = (k: 'biometric' | 'autoLock', v: boolean) => {
    if (k === 'biometric' && v && bioAvailable !== true) return;
    setConfirm(null);
    setSecurity((s) => ({ ...s, [k]: v }));
    void saveAppSettings(k === 'biometric' ? { biometrics: v } : { autoLock: v }).catch(() => undefined);
    // Turning auto-lock off re-locks immediately: the session must not ride
    // on a control that was just switched away.
    if (k === 'autoLock' && !v) onLock?.();
  };

  const setSecurityFlag = (k: 'biometric' | 'autoLock') => (v: boolean) => {
    if (v) {
      applySecurityFlag(k, v);
      return;
    }
    setConfirm(k);
  };

  // The step-up itself: the in-app PIN against the persisted verifier, with
  // the same lockout bookkeeping as the app lock (shared pinEntryCheck). The
  // failure copy is context-neutral: the user is entering their PIN.
  const confirmLock = usePinEntry({
    target: null,
    settle: 200,
    resetKey: confirm ?? '',
    check: confirm ? pinEntryCheck({ unsetCopy: t('onboarding.pin.verifyFailed') }) : undefined,
    checkFailureCopy: t('onboarding.pin.verifyFailed'),
    onMatch: () => {
      if (confirm) applySecurityFlag(confirm, false);
    },
  });

  // Self-custody: signing out destroys local state, so the phrase is the only
  // way back. Confirm destructively rather than on a single tap.
  const confirmSignOut = () =>
    Alert.alert(
      t('settings.signout.title'),
      t('settings.signout.body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('settings.signout.cta'), style: 'destructive', onPress: () => onSignOut?.() },
      ],
    );

  if (!profile || !networks) return <Screen />;

  // Displayed biometrics state folds in the capability probe: a persisted
  // true on hardware without biometrics reads as off (the unlock flow treats
  // it the same way).
  const biometricsOn = security.biometric && bioAvailable !== false;

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
          {/* Profile editing has no backend in M2: the dead-end Edit control
              stays hidden until it does something. */}
        </Card>
      </View>

      <Section title={t('settings.section.security')}>
        <ListRow
          icon="fingerprint"
          iconColor={C.amber}
          label={t('settings.security.biometrics')}
          sub={bioAvailable === false ? t('onboarding.secure.unavailable') : t('settings.security.biometricsSub')}>
          <Toggle on={biometricsOn} disabled={bioAvailable === false} onChange={setSecurityFlag('biometric')} />
        </ListRow>
        <ListRow icon="lock" label={t('settings.security.autolock')} sub={t('settings.security.autolockSub')} divider>
          <Toggle on={security.autoLock} onChange={setSecurityFlag('autoLock')} />
        </ListRow>
        <ListRow icon="shield" iconColor={C.green} label={t('settings.backup.reveal')} sub={t('settings.backup.revealSub', { count: wordCount ?? 24 })} trailing="→" divider onPress={onBackup} />
        <ListRow icon="lock" label={t('settings.changePin')} trailing="→" divider onPress={onChangePin} />
        {/* dApp sessions have no backend in M2: the dead-end row stays hidden
            until real sessions exist. */}
        {confirm && (
          <Card variant="inset" accent={C.amber} className="mt-2.5 p-4 rounded-[16px]">
            <Txt className="text-[14px] font-semibold">{t('settings.security.confirmTitle')}</Txt>
            <Txt className="text-[12px] text-text2 mt-1 leading-[17px]">
              {t(
                confirm === 'autoLock' ? 'settings.security.confirmBodyLock' : 'settings.security.confirmBody',
                { feature: t(confirm === 'autoLock' ? 'settings.security.autolock' : 'settings.security.biometrics') },
              )}
            </Txt>
            <View className="items-center mt-5">
              <PinDots value={confirmLock.val} error={confirmLock.err} />
            </View>
            <Txt
              className="text-[12px] text-center mt-3 h-4"
              style={{ color: confirmLock.err || confirmLock.locked ? C.red : C.text3 }}>
              {confirmLock.locked
                ? t('onboarding.pin.locked', { seconds: confirmLock.lockLeft })
                : confirmLock.msg}
            </Txt>
            <View className="mt-2">
              <Keypad
                disabled={confirmLock.locked}
                onKey={(k) => {
                  if (confirmLock.val.length < 6) confirmLock.setValue(confirmLock.val + k);
                }}
                onDelete={() => confirmLock.setValue(confirmLock.val.slice(0, -1))}
              />
            </View>
            <Btn tone="ghost" className="mt-2" onPress={() => setConfirm(null)}>
              {t('common.cancel')}
            </Btn>
          </Card>
        )}
      </Section>

      <Section title={t('settings.section.networks')}>
        {/* A status row, not a button: network management beyond the testnet
            switch does not exist yet, and the sub must not overclaim a
            custom-RPC editor. */}
        <ListRow icon="bridge" iconColor={C.violet} label={t('settings.networks.manage')} sub={t('settings.networks.manageSub', { count: networks.length })} divider />
        <ListRow
          icon="flash"
          iconColor={C.amber}
          label={t('settings.network.mode')}
          sub={t(network === 'testnet' ? 'settings.network.testnet' : 'settings.network.mainnet')}
          divider
        >
          <Toggle
            on={network === 'testnet'}
            onChange={(v) => {
              // The switch rebuilds the providers (cache wipe) after an
              // explicit confirm; the copy names the pending testnet base.
              Alert.alert(
                t(v ? 'settings.network.testnet' : 'settings.network.mainnet'),
                t('settings.network.switchWarn'),
                [
                  { text: t('common.cancel'), style: 'cancel' },
                  { text: t('common.continue'), onPress: () => onNetworkChange?.(v) },
                ],
              );
            }}
          />
        </ListRow>
        <ListRow icon="chart" iconColor={C.teal} label={t('settings.dex')} sub={t(dex === 'mintlayer' ? 'settings.dexes.mintlayer' : 'settings.dexes.auto')} trailing="→" divider onPress={() => setSheet('dex')} />
      </Section>

      <Section title={t('settings.section.preferences')}>
        {waitlist?.joined && (
          <ListRow
            icon="card"
            iconColor={C.amber}
            label={t('settings.waitlist.joined', { maskedEmail: maskEmail(waitlist.email ?? '') })}
            divider
            onPress={confirmLeaveWaitlist}
          />
        )}
        <ListRow icon="eye" label={t('settings.display.hideBalances')} sub={t('settings.display.hideBalancesSub')}>
          <Toggle on={flags.hideBal} onChange={set('hideBal')} />
        </ListRow>
        <ListRow icon="bell" iconColor={C.amber} label={t('settings.notifications')} sub={t('settings.notificationsSub')} divider>
          <Toggle on={flags.notifs} onChange={set('notifs')} />
        </ListRow>
        <ListRow
          icon="settings"
          label={t('settings.currency')}
          sub={`USD · ${t('settings.comingSoon')}`}
          divider
        />
        <ListRow
          icon="settings"
          label={t('settings.appearance')}
          sub={`${t('settings.appearance.dark')} · ${t('settings.comingSoon')}`}
          divider
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

// Display preferences are the USD/dark defaults in M2; the pickers return
// with their backends.

type DexId = 'mintlayer' | 'auto';
const DEXES: readonly DexId[] = ['mintlayer', 'auto'];

