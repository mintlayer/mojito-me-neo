import React, { useEffect } from 'react';
import { View } from 'react-native';
import { t } from '../../i18n';
import { Btn, Txt } from '../../ui';
import { BioCircle, Column, LinkBtn, StepHeader, useBioScan } from '../ui';
import { bioGuard, bioName } from '../context';
import type { Ctx } from '../context';

/**
 * Biometric enrolment: a real expo-local-authentication prompt. Success flips
 * the session's biometrics flag so the unlock screen knows to lead with the
 * device check; "Use PIN instead" keeps a PIN-only wallet fully working.
 */
export function Secure({ ctx }: { ctx: Ctx }) {
  const scan = useBioScan(
    () => {
      ctx.setBiometrics(true);
      ctx.push('pin-set');
    },
    () => ctx.setBiometrics(false),
  );
  const name = bioGuard(ctx.bio);
  const status =
    scan.phase === 'scan'
      ? t('onboarding.bio.scanning')
      : scan.phase === 'ok'
        ? t('onboarding.bio.verified')
        : scan.unavailable
          ? t('onboarding.secure.unavailable')
          : scan.failures >= 2
            ? t('onboarding.unlock.pinFallback')
            : t('onboarding.bio.tapToEnable', { bio: bioName(ctx.bio) });

  // Devices without enrolled biometrics skip straight to the PIN: the
  // enrolment circle would be a dead control.
  useEffect(() => {
    if (scan.unavailable) ctx.setBiometrics(false);
  }, [scan.unavailable, ctx]);

  return (
    <Column>
      <StepHeader onBack={ctx.pop} step={1} />
      <View className="flex-1 px-6 pt-6">
        <Txt className="text-[24px] font-bold tracking-tightest">{t('onboarding.secure.title')}</Txt>
        <Txt className="text-[13px] text-text2 mt-2 leading-[20px]">
          {ctx.bioAvailable ? t('onboarding.secure.body', { bio: name }) : t('onboarding.secure.bodyPinOnly')}
        </Txt>

        <View className="flex-1 items-center justify-center gap-3.5">
          <BioCircle bio={ctx.bio} phase={scan.phase} onPress={scan.start} />
          <Txt className="text-[12px] text-text2">{status}</Txt>
        </View>

        <Btn tone="primary" disabled={scan.unavailable} onPress={scan.start}>
          {scan.phase === 'idle'
            ? t('onboarding.bio.enable', { bio: bioName(ctx.bio) })
            : scan.phase === 'scan'
              ? t('onboarding.bio.scanning')
              : t('onboarding.bio.verifiedCheck')}
        </Btn>
        <LinkBtn className="mt-3.5" onPress={() => ctx.push('pin-set')}>
          {t('onboarding.secure.usePin')}
        </LinkBtn>
      </View>
    </Column>
  );
}

/* ══ 2 · PIN ════════════════════════════════════════════════ */

/** Both PIN screens are title + dots + keypad; only the verdict differs. */
