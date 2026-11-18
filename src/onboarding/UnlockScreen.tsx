import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { t } from '../i18n';
import { pinStore } from '../storage/pinStore';
import { C } from '../theme';
import { Btn, MojitoLogo, Txt } from '../ui';
import { Bio, BioCircle, BioGlyph, Column, Keypad, PinDots, useBioScan, usePinEntry, pinEntryCheck } from './ui';
import { bioName } from './context';

/**
 * The app lock. Biometrics are the convenience path (a real
 * expo-local-authentication prompt, shown when the session enabled them);
 * the PIN is the always-working path, verified against the persisted
 * verifier with the same lockout counter the rest of the app uses. The
 * lockout survives app restarts: the deadline lives in pinStore, and both
 * paths (PIN and bio) are blocked while it is armed.
 */
export function UnlockScreen({ bio, biometrics, onUnlock }: { bio: Bio; biometrics: boolean; onUnlock: () => void | Promise<void> }) {
  const [mode, setMode] = useState<'bio' | 'pin'>(biometrics ? 'bio' : 'pin');
  const [verifying, setVerifying] = useState(false);
  const onUnlockRef = useRef(onUnlock);
  useEffect(() => {
    onUnlockRef.current = onUnlock;
  });

  // The scan's ok phase only means the UI-level check passed; the real gate
  // prompt for the vault key fires inside the native module afterwards. The
  // label shows Verifying while that resolution is in flight, and when it
  // comes back declined (the app re-locks, this screen stays mounted) the
  // ok phase drops so the copy never claims an unlock that did not happen.
  const resetRef = useRef<() => void>(() => undefined);
  // Re-entrancy guard: a second scan or tap while an unlock is in flight
  // must not fire a second gate resolution (duplicate native prompts).
  const verifyingRef = useRef(false);
  const runUnlock = useCallback(() => {
    if (verifyingRef.current) return;
    verifyingRef.current = true;
    setVerifying(true);
    void Promise.resolve(onUnlockRef.current()).finally(() => {
      verifyingRef.current = false;
      setVerifying(false);
      resetRef.current();
    });
  }, []);
  const scan = useBioScan(runUnlock);
  useEffect(() => {
    resetRef.current = scan.reset;
  });

  // Bio attempts consult the same armed lockout as the PIN path: a lockout
  // armed by wrong PINs must not leave the default biometric path fully
  // live. The countdown polls pinStore while the bio mode is up.
  const [bioLockLeft, setBioLockLeft] = useState(0);
  useEffect(() => {
    if (mode !== 'bio') return;
    let alive = true;
    const tick = () => {
      void pinStore.lockSecondsLeft().then((seconds) => {
        if (alive) setBioLockLeft(seconds);
      });
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [mode]);

  // A lock armed in a previous run resumes its countdown immediately.
  useEffect(() => {
    if (mode !== 'pin') return;
    void pinStore.lockSecondsLeft().then((seconds) => pinLock.armLock(seconds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const startBio = () => {
    if (bioLockLeft > 0) return;
    scan.start();
  };

  const pinLock = usePinEntry({
    target: null,
    settle: 200,
    onMatch: () => {
      void pinStore.resetAttempts();
      // The store-backed verdict matched, but the vault key gate still has
      // to resolve: the PIN path drives the same Verifying state as bio.
      runUnlock();
    },
    // Store-backed verdict shared with the Settings disable step-up; the
    // lockout bookkeeping (registerFailure, escalation) lives in one place.
    check: pinEntryCheck(),
  });
  const { val, setValue, err, msg, lockLeft, locked } = pinLock;

  return (
    <Column>
      <View className="items-center mt-8">
        <MojitoLogo size={52} animate={false} />
        <Txt className="text-[22px] font-bold tracking-tightest mt-3.5">{t('onboarding.unlock.title')}</Txt>
      </View>

      {mode === 'bio' ? (
        <>
          <View className="flex-1 items-center justify-center gap-3.5">
            <BioCircle bio={bio} phase={scan.phase} onPress={startBio} />
            <Txt className="text-[12px] text-text2">
              {bioLockLeft > 0
                ? t('onboarding.pin.locked', { seconds: bioLockLeft })
                : scan.phase === 'scan'
                  ? t('onboarding.bio.scanning')
                  : scan.phase === 'ok'
                    ? t('onboarding.unlock.verifying')
                    : scan.failures >= 2
                      ? t('onboarding.unlock.pinFallback')
                      : scan.unavailable
                        ? t('onboarding.secure.unavailable')
                        : t('onboarding.unlock.tapToUnlock', { bio: bioName(bio) })}
            </Txt>
          </View>
          <View className="px-6">
            <Btn onPress={() => setMode('pin')}>{t('onboarding.unlock.usePin')}</Btn>
          </View>
        </>
      ) : (
        <>
          <Txt className="text-[13px] text-text2 text-center mt-2">{t('onboarding.unlock.pinPrompt')}</Txt>
          <View className="mt-9">
            <PinDots value={val} error={err} />
          </View>
          <Txt className="text-[12px] text-center mt-4 h-4" style={{ color: err || locked ? C.red : C.text3 }}>
            {locked
              ? t('onboarding.pin.locked', { seconds: lockLeft })
              : verifying
                ? t('onboarding.unlock.verifying')
                : msg}
          </Txt>
          {/* No bio switch while a lockout is active: bio attempts during the
              countdown would bypass the app's escalating counter (the project
              decision log records the biometry-only product decision). */}
          <View className="flex-1" />
          <Keypad
            disabled={locked || verifying}
            onKey={(k) => {
              if (val.length < 6) setValue(val + k);
            }}
            onDelete={() => setValue(val.slice(0, -1))}
            corner={
              // Matches the Keypad gating plus the in-flight unlock: the
              // corner must not switch to bio mode while verifying, or a
              // second scan races the running gate resolution.
              !locked && !verifying ? (
                <Pressable
                  onPress={() => setMode('bio')}
                  accessibilityRole="button"
                  accessibilityLabel={t('onboarding.unlock.bioSwitch', { bio: bioName(bio) })}
                  className="p-2">
                  <BioGlyph bio={bio} size={26} color={C.text2} />
                </Pressable>
              ) : null
            }
          />
        </>
      )}
    </Column>
  );
}
