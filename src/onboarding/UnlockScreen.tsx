import React, { useEffect, useRef, useState } from 'react';
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
 * lockout survives app restarts: the deadline lives in pinStore.
 */
export function UnlockScreen({ bio, biometrics, onUnlock }: { bio: Bio; biometrics: boolean; onUnlock: () => void }) {
  const [mode, setMode] = useState<'bio' | 'pin'>(biometrics ? 'bio' : 'pin');
  const scan = useBioScan(onUnlock);
  const onUnlockRef = useRef(onUnlock);
  useEffect(() => {
    onUnlockRef.current = onUnlock;
  });

  // A lock armed in a previous run resumes its countdown immediately.
  useEffect(() => {
    if (mode !== 'pin') return;
    void pinStore.lockSecondsLeft().then((seconds) => pinLock.armLock(seconds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const pinLock = usePinEntry({
    target: null,
    settle: 200,
    onMatch: () => {
      void pinStore.resetAttempts();
      onUnlockRef.current();
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
            <BioCircle bio={bio} phase={scan.phase} onPress={scan.start} />
            <Txt className="text-[12px] text-text2">
              {scan.phase === 'scan'
                ? t('onboarding.bio.scanning')
                : scan.phase === 'ok'
                  ? t('onboarding.unlock.unlocked')
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
            {locked ? t('onboarding.pin.locked', { seconds: lockLeft }) : msg}
          </Txt>
          {/* No bio switch while a lockout is active: bio attempts during the
              countdown would bypass the app's escalating counter (decisions.md
              records the biometry-only product decision). */}
          <View className="flex-1" />
          <Keypad
            disabled={locked}
            onKey={(k) => {
              if (val.length < 6) setValue(val + k);
            }}
            onDelete={() => setValue(val.slice(0, -1))}
            corner={
              !locked ? (
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
