import React, { useState } from 'react';
import { t } from '../../i18n';
import type { Ctx } from '../context';
import { PinPad } from './PinPad';
import { bioName } from '../context';
import { pinEntryCheck, usePinEntry } from '../ui';

/**
 * PIN setup. Two shapes:
 * - fresh onboarding: collect six digits and hand them to PinConfirm;
 * - change PIN (pinOnly): verify the current PIN from the store first, then
 *   collect the replacement. Wrong old PINs feed the same lockout counter.
 */
export function PinSet({ ctx }: { ctx: Ctx }) {
  const [phase, setPhase] = useState<'verify-old' | 'collect'>(ctx.pinOnly ? 'verify-old' : 'collect');

  const { val, setValue, err, msg, lockLeft, locked } = usePinEntry({
    // In verify-old mode the verdict comes from the persisted verifier,
    // through the shared store-backed check so the lockout bookkeeping is
    // identical everywhere. The failure copy is context-neutral: the user is
    // entering their PIN, not unlocking.
    target: null,
    resetKey: phase,
    check: phase === 'verify-old' ? pinEntryCheck({ unsetCopy: t('onboarding.pin.verifyFailed') }) : undefined,
    checkFailureCopy: t('onboarding.pin.verifyFailed'),
    onMatch: (pin) => {
      if (phase === 'verify-old') {
        setPhase('collect');
      } else {
        ctx.setPin(pin);
        ctx.push('pin-confirm');
      }
    },
  });

  const verifying = phase === 'verify-old';
  return (
    <PinPad
      ctx={ctx}
      title={verifying ? t('settings.changePin.verifyOld') : t('onboarding.pin.set')}
      subtitle={
        verifying
          ? t('settings.changePin.verifyOldSub')
          : ctx.bioAvailable
            ? t('onboarding.pin.setSub', { bio: bioName(ctx.bio) })
            : t('onboarding.pin.setSubPinOnly')
      }
      value={val}
      setValue={setValue}
      message={locked ? t('onboarding.pin.locked', { seconds: lockLeft }) : msg}
      error={err}
      disabled={locked}
    />
  );
}
