import React, { useEffect, useState } from 'react';
import { Alert, AppState, Pressable, View } from 'react-native';
import { BlurView } from 'expo-blur';
import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import './global.css';

import { t } from './src/i18n';
import { ProvidersProvider } from './src/data/providers/context';
import { VaultKeyInvalidatedError } from './modules/mojito-core';
import { walletVault, type VaultMeta, type WalletVaultHandle } from './src/storage/walletVault';
import { pinStore } from './src/storage/pinStore';
import { loadAppSettings, saveAppSettings } from './src/storage/appSettings';
import { detectBio } from './src/onboarding/ui/useBioScan';
import { C, alpha } from './src/theme';
import { AppBackground, Icon, IconName, Txt } from './src/ui';
import { Onboarding, type OnboardingResult, UnlockScreen } from './src/onboarding';
import type { Bio } from './src/onboarding/ui';
import { Splash } from './src/screens/intro';
import type { Nav, Sheet } from './src/screens/types';
import { HomeScreen } from './src/screens/HomeScreen';
import { DexScreen } from './src/screens/DexScreen';
import { SwapScreen } from './src/screens/SwapScreen';
import { BridgeScreen } from './src/screens/BridgeScreen';
import { CardScreen } from './src/screens/CardScreen';
import { SendScreen } from './src/screens/SendScreen';
import { ReceiveScreen } from './src/screens/ReceiveScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';

type TabId = 'home' | 'dex' | 'swap' | 'bridge' | 'card';
type Overlay = 'send' | 'receive' | 'settings' | null;

const TABS: { id: TabId; icon: IconName; labelKey: 'tabs.wallet' | 'tabs.dex' | 'tabs.swap' | 'tabs.bridge' | 'tabs.card' }[] = [
  { id: 'home', icon: 'home', labelKey: 'tabs.wallet' },
  { id: 'dex', icon: 'chart', labelKey: 'tabs.dex' },
  { id: 'swap', icon: 'swap', labelKey: 'tabs.swap' },
  { id: 'bridge', icon: 'bridge', labelKey: 'tabs.bridge' },
  { id: 'card', icon: 'card', labelKey: 'tabs.card' },
];

// Only Home consumes the nav callbacks; the rest ignore them.
const SCREENS: Record<TabId, React.ComponentType<Nav>> = {
  home: HomeScreen,
  dex: DexScreen,
  swap: SwapScreen,
  bridge: BridgeScreen,
  card: CardScreen,
};

// Settings takes extra nav props; the others ignore them.
const OVERLAYS: Record<Exclude<Overlay, null>, React.ComponentType<Sheet>> = {
  send: SendScreen,
  receive: ReceiveScreen,
  settings: SettingsScreen,
};

export default function App() {
  // Expo Go lacks the local native module; only dev builds launch the app.
  if (Constants.appOwnership === 'expo') {
    return (
      <View className="flex-1 items-center justify-center px-8" style={{ backgroundColor: C.bg0 }}>
        <Txt className="text-[14px] text-text2 text-center leading-[20px]">{t('common.devClientRequired')}</Txt>
      </View>
    );
  }
  return (
    <SafeAreaProvider>
      <ProvidersProvider>
        <StatusBar style="light" />
        <Shell />
      </ProvidersProvider>
    </SafeAreaProvider>
  );
}

/** Stacking order for the full-bleed layers, so it reads in one place. */
const Z = { overlay: 70, onboarding: 80, backup: 85, changePin: 86, lock: 90 } as const;

/** Full-bleed layer over the tab UI (overlays, onboarding, lock). */
function Layer({ children, z }: { children: React.ReactNode; z: number }) {
  return (
    <View className="absolute inset-0" style={{ backgroundColor: C.bg0, zIndex: z }}>
      <AppBackground />
      {children}
    </View>
  );
}

/** The app-level session: key handles and flags, never seed bytes. The
 *  vault handle carries vault metadata only; phrase decryption happens
 *  exclusively inside KeySession closures after PIN or biometrics. */
type AppSession = {
  vault: WalletVaultHandle | null;
  deferred: boolean;
  bio: Bio;
  /** The persisted Secure-screen choice. Kept distinct from
   *  settings.biometrics, which folds in hardware detection for the unlock
   *  UI: only a real choice justifies treating the vault key as gated. */
  bioChoice: boolean;
  settings: { biometrics: boolean; autoLock: boolean; testnet: boolean };
};

function Shell() {
  const [splashDone, setSplashDone] = useState(false);
  /** Whether the vault-existence check finished; drives onboarding vs lock. */
  const [ready, setReady] = useState(false);
  /** null until onboarding completes (or a stored wallet is found). */
  const [session, setSession] = useState<AppSession | null>(null);
  const [locked, setLocked] = useState(false);
  /** Re-entering just the backup flow from the deferred-backup banner. */
  const [backup, setBackup] = useState(false);
  /** Settings > Change PIN reuses the onboarding PIN pair. */
  const [changePin, setChangePin] = useState(false);
  const [tab, setTab] = useState<TabId>('home');
  const [overlay, setOverlay] = useState<Overlay>(null);

  // Cold start: does this device already hold a sealed wallet? Existence is
  // checked without decrypting (the native query is attribute-level, so no
  // biometric prompt can fire behind the splash); unlock happens only after
  // PIN or biometrics. The persisted biometrics choice (Secure screen
  // enrolment, Settings toggle) gates the bio unlock: a "Use PIN instead"
  // onboarding choice or a disabled toggle keeps the PIN-only lock even on
  // capable hardware.
  useEffect(() => {
    void (async () => {
      try {
        if (await walletVault.exists()) {
          const [detected, saved] = await Promise.all([
            detectBio(),
            loadAppSettings().catch(() => ({ biometrics: null, autoLock: true })),
          ]);
          const wantBio = (saved.biometrics ?? detected !== null) && detected !== null;
          setSession({
            vault: null,
            deferred: false,
            bio: detected ?? 'face',
            bioChoice: saved.biometrics === true,
            settings: { biometrics: wantBio, autoLock: saved.autoLock, testnet: false },
          });
          setLocked(true);
        }
      } catch {
        // The existence probe itself failed: degrade to the locked state so
        // a cancelled prompt or a keychain hiccup can never wedge the app on
        // the splash. Unlocking re-runs the real decrypt and surfaces the
        // failure there.
        const detected = await detectBio();
        setSession({
          vault: null,
          deferred: false,
          bio: detected ?? 'face',
          bioChoice: false,
          settings: { biometrics: detected !== null, autoLock: true, testnet: false },
        });
        setLocked(true);
      }
      setReady(true);
    })();
  }, []);

  // Auto-lock: leaving the app (home button, app switcher) re-locks the
  // session when the persisted auto-lock setting is on (default on). A lock
  // above an open backup or change-PIN layer is harmless: unlocking simply
  // returns to where the user was.
  useEffect(() => {
    if (!session?.settings.autoLock) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') setLocked(true);
    });
    return () => sub.remove();
  }, [session?.settings.autoLock]);

  /** Terminal key state guidance: the phrase is the only way back, so the
   *  alert offers the erase. */
  const alertInvalidated = () => {
    Alert.alert(t('onboarding.unlock.invalidatedTitle'), t('onboarding.unlock.invalidatedBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('onboarding.unlock.invalidatedErase'), style: 'destructive', onPress: () => signOut() },
    ]);
  };

  const unlock = () => {
    void (async () => {
      let meta: VaultMeta | null = null;
      try {
        meta = await walletVault.meta();
      } catch (e) {
        // The native key gate prompts inside the module. A cancelled or
        // failed prompt keeps the wallet locked; the next attempt re-runs
        // the prompt.
        if (e instanceof VaultKeyInvalidatedError) alertInvalidated();
        setLocked(true);
        return;
      }
      // Gate-alignment failure is retryable by construction: the two-slot
      // re-seal keeps the old vault intact until the new slot verifies, so
      // the session continues on the old vault, one message says so, and
      // the next unlock retries. The old key dying mid-upgrade is terminal
      // and gets the same recovery guidance as a failed unlock.
      let upgradeFailed = false;
      if (meta) {
        try {
          await upgradeKeyGating(meta);
        } catch (e) {
          if (e instanceof VaultKeyInvalidatedError) {
            alertInvalidated();
            setLocked(true);
            return;
          }
          // VaultUpgradeError (the re-seal bailed before the verified
          // readback) and a declined prompt on the old gated key are both
          // retryable with the old vault intact; nothing on this path can
          // lose the wallet, and it must not escape as an unhandled
          // rejection.
          upgradeFailed = true;
        }
      }
      // null meta means the blob is gone (post-wipe recovery window); there
      // is nothing to re-seal and nothing to gate, unlock as before.
      setSession((s) => (s && meta ? { ...s, vault: { meta } } : s));
      setLocked(false);
      if (upgradeFailed) {
        Alert.alert(t('onboarding.unlock.upgradeTitle'), t('onboarding.unlock.upgradeBody'));
      }
    })();
  };

  /** Gate alignment at unlock, both directions: the persisted Secure-screen
   *  choice decides the vault key's native gate. A biometrics choice over a
   *  legacy ungated key re-seals gated; a disabled toggle re-seals ungated,
   *  so after it settles the PIN alone always opens. walletVault.upgradeGating
   *  only deletes the old slot after the new one verifies, so a failure
   *  here is retryable and never loses data. */
  const upgradeKeyGating = async (meta: VaultMeta): Promise<void> => {
    const wantGated = session?.bioChoice ?? false;
    if ((await walletVault.keyGated()) === wantGated) return;
    const words = await walletVault.openWords();
    await walletVault.upgradeGating(words, meta, wantGated);
  };

  const finishOnboarding = (r: OnboardingResult) => {
    void (async () => {
      // Persist the Secure-screen choice so cold start respects "Use PIN
      // instead"; a failure must not block an otherwise complete onboarding.
      await saveAppSettings({ biometrics: r.biometrics }).catch(() => undefined);
      const meta = await walletVault.meta().catch(() => null);
      setSession({
        vault: meta ? { meta } : null,
        deferred: r.deferred,
        bio: r.bio,
        bioChoice: r.biometrics,
        settings: { biometrics: r.biometrics, autoLock: true, testnet: false },
      });
    })();
  };

  /** Recovery-phrase reveal is a step-up boundary: entering the backup flow
   *  re-locks the session, so the phrase is only reachable through the PIN or
   *  biometric unlock screen, never straight from an unlocked session. */
  const revealBackup = () => {
    setOverlay(null);
    setBackup(true);
    setLocked(true);
  };

  /** Settings sign-out: the device forgets the keys, per its own copy. A
   *  failed wipe must not drop the session state: the vault is re-verified
   *  gone before the app returns to onboarding, and the error surfaces. */
  const signOut = () => {
    void (async () => {
      let gone = false;
      try {
        await Promise.all([walletVault.wipe(), pinStore.wipe()]);
        gone = !(await walletVault.exists());
      } catch {
        gone = false;
      }
      if (!gone) {
        Alert.alert(t('settings.signout.wipeErrorTitle'), t('settings.signout.wipeErrorBody'));
        return;
      }
      setSession(null);
      setLocked(false);
      setBackup(false);
      setChangePin(false);
      setOverlay(null);
    })();
  };

  const Active = SCREENS[tab];
  const Sheet = overlay ? OVERLAYS[overlay] : null;

  return (
    <View className="flex-1" style={{ backgroundColor: C.bg0 }}>
      <AppBackground />

      {session && (
        <>
          <Active
            onOpenSend={() => setOverlay('send')}
            onOpenReceive={() => setOverlay('receive')}
            onOpenSettings={() => setOverlay('settings')}
            onGoto={(t: string) => setTab(t as TabId)}
            deferred={session.deferred}
            onBackUp={revealBackup}
            onLock={() => setLocked(true)}
          />

          {Sheet && (
            <Layer z={Z.overlay}>
              <Sheet
                onClose={() => setOverlay(null)}
                bio={session.bio}
                onBackup={() => {
                  setOverlay(null);
                  revealBackup();
                }}
                onChangePin={() => {
                  setOverlay(null);
                  setChangePin(true);
                }}
                onLock={() => {
                  setOverlay(null);
                  setLocked(true);
                }}
                onSignOut={() => {
                  setOverlay(null);
                  signOut();
                }}
              />
            </Layer>
          )}

          {!overlay && <TabBar tab={tab} onChange={setTab} />}
        </>
      )}

      {/* First run: the onboarding flow owns the whole screen. */}
      {ready && !session && splashDone && (
        <Layer z={Z.onboarding}>
          <Onboarding onDone={finishOnboarding} />
        </Layer>
      )}

      {/* Deferred backup: re-enter at the seed step only; it reveals the
          stored phrase and must not re-seal a fresh one. */}
      {session && backup && (
        <Layer z={Z.backup}>
          <Onboarding
            initial="seed"
            backup
            bio={session.bio}
            locked={locked}
            onDone={(r) => {
              setSession((s) => (s ? { ...s, deferred: r.deferred } : s));
              setBackup(false);
            }}
          />
        </Layer>
      )}

      {session && changePin && (
        <Layer z={Z.changePin}>
          <Onboarding
            initial="pin-set"
            pinOnly
            backup
            bio={session.bio}
            locked={locked}
            onDone={() => setChangePin(false)}
          />
        </Layer>
      )}

      {session && locked && (
        <Layer z={Z.lock}>
          <UnlockScreen bio={session.bio} biometrics={session.settings.biometrics} onUnlock={unlock} />
        </Layer>
      )}

      {!splashDone && <Splash onDone={() => setSplashDone(true)} />}
    </View>
  );
}

/** Floating glass tab bar. */
function TabBar({ tab, onChange }: { tab: TabId; onChange: (t: TabId) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="absolute left-4 right-4 h-16 rounded-[22px] flex-row overflow-hidden"
      style={{ bottom: Math.max(insets.bottom, 12) + 8, borderWidth: 1, borderColor: C.lineSoft, zIndex: 30 }}>
      <BlurView intensity={40} tint="dark" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: alpha(C.bg1, 0.6) }} />

      {TABS.map((entry) => {
        const on = entry.id === tab;
        const label = t(entry.labelKey);
        return (
          <Pressable
            key={entry.id}
            onPress={() => onChange(entry.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={label}
            className="flex-1 items-center justify-center gap-[3px]">
            {on && (
              <View
                className="absolute top-2 w-7 h-[3px] rounded-full"
                style={{ backgroundColor: C.amber, shadowColor: C.amber, shadowOpacity: 0.8, shadowRadius: 6 }}
              />
            )}
            <Icon name={entry.icon} size={20} color={on ? C.amber : C.text2} stroke={on ? 1.8 : 1.6} />
            <Txt className="text-[10px] font-medium tracking-wider" style={{ color: on ? C.text0 : C.text2 }}>
              {label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
