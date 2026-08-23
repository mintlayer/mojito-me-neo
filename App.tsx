import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import './global.css';

import { C, alpha } from './src/theme';
import { AppBackground, Icon, IconName, Txt } from './src/ui';
import { Onboarding, OnboardingResult, UnlockScreen } from './src/onboarding';
import { Splash } from './src/screens/intro';
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

const TABS: { id: TabId; icon: IconName; label: string }[] = [
  { id: 'home', icon: 'home', label: 'Wallet' },
  { id: 'dex', icon: 'chart', label: 'DEX' },
  { id: 'swap', icon: 'swap', label: 'Swap' },
  { id: 'bridge', icon: 'bridge', label: 'Bridge' },
  { id: 'card', icon: 'card', label: 'Card' },
];

// Only Home consumes the nav callbacks; the rest ignore them.
const SCREENS: Record<TabId, React.ComponentType<any>> = {
  home: HomeScreen,
  dex: DexScreen,
  swap: SwapScreen,
  bridge: BridgeScreen,
  card: CardScreen,
};

// Settings takes extra nav props; the others ignore them.
const OVERLAYS: Record<string, React.ComponentType<any>> = {
  send: SendScreen,
  receive: ReceiveScreen,
  settings: SettingsScreen,
};

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Shell />
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

function Shell() {
  const [splashDone, setSplashDone] = useState(false);
  /** null until onboarding completes — there is no wallet before that. */
  const [session, setSession] = useState<OnboardingResult | null>(null);
  const [locked, setLocked] = useState(false);
  /** Re-entering just the backup flow from the deferred-backup banner. */
  const [backup, setBackup] = useState(false);
  /** Settings > Change PIN reuses the onboarding PIN pair. */
  const [changePin, setChangePin] = useState(false);
  const [tab, setTab] = useState<TabId>('home');
  const [overlay, setOverlay] = useState<Overlay>(null);

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
            onBackUp={() => setBackup(true)}
            onLock={() => setLocked(true)}
          />

          {Sheet && (
            <Layer z={Z.overlay}>
              <Sheet
                onClose={() => setOverlay(null)}
                onBackup={() => {
                  setOverlay(null);
                  setBackup(true);
                }}
                onChangePin={() => {
                  setOverlay(null);
                  setChangePin(true);
                }}
                onLock={() => {
                  setOverlay(null);
                  setLocked(true);
                }}
              />
            </Layer>
          )}

          {!overlay && <TabBar tab={tab} onChange={setTab} />}
        </>
      )}

      {/* First run: the onboarding flow owns the whole screen. */}
      {!session && splashDone && (
        <Layer z={Z.onboarding}>
          <Onboarding onDone={setSession} />
        </Layer>
      )}

      {/* Deferred backup: re-enter at the seed step only. */}
      {session && backup && (
        <Layer z={Z.backup}>
          <Onboarding
            initial="seed"
            bio={session.bio}
            onDone={(r) => {
              setSession({ ...session, deferred: r.deferred });
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
            bio={session.bio}
            onDone={(r) => {
              setSession({ ...session, pin: r.pin });
              setChangePin(false);
            }}
          />
        </Layer>
      )}

      {session && locked && (
        <Layer z={Z.lock}>
          <UnlockScreen bio={session.bio} pin={session.pin} onUnlock={() => setLocked(false)} />
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

      {TABS.map((t) => {
        const on = t.id === tab;
        return (
          <Pressable
            key={t.id}
            onPress={() => onChange(t.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t.label}
            className="flex-1 items-center justify-center gap-[3px]">
            {on && (
              <View
                className="absolute top-2 w-7 h-[3px] rounded-full"
                style={{ backgroundColor: C.amber, shadowColor: C.amber, shadowOpacity: 0.8, shadowRadius: 6 }}
              />
            )}
            <Icon name={t.icon} size={20} color={on ? C.amber : C.text2} stroke={on ? 1.8 : 1.6} />
            <Txt className="text-[10px] font-medium tracking-wider" style={{ color: on ? C.text0 : C.text2 }}>
              {t.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
