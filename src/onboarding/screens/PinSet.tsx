import React, { useState } from 'react';
import { t } from '../../i18n';
import { pinStore, LOCK_ATTEMPTS } from '../../storage/pinStore';
import type { Ctx } from '../context';
import { PinPad } from './PinPad';
import { bioName } from '../context';
import { usePinEntry } from '../ui';

/**
 * PIN setup. Two shapes:
 * - fresh onboarding: collect six digits and hand them to PinConfirm;
 * - change PIN (pinOnly): verify the current PIN from the store first, then
 *   collect the replacement. Wrong old PINs feed the same lockout counter.
 */
export function PinSet({ ctx }: { ctx: Ctx }) {
  const [phase, setPhase] = useState<'verify-old' | 'collect'>(ctx.pinOnly ? 'verify-old' : 'collect');

  const { val, setValue, err, msg, lockLeft, locked } = usePinEntry({
    // In verify-old mode the verdict comes from the persisted verifier.
    target: null,
    resetKey: phase,
    check:
      phase === 'verify-old'
        ? async (pin) => {
            const verdict = await pinStore.verify(pin);
            if (verdict === 'ok') return { verdict: 'ok' };
            if (verdict === 'locked') {
              const seconds = await pinStore.lockSecondsLeft();
              return {
                verdict: 'locked',
                message: t('onboarding.pin.locked', { seconds }),
                lockSeconds: seconds,
              };
            }
            await pinStore.registerFailure();
            const seconds = await pinStore.lockSecondsLeft();
            if (seconds > 0) {
              return {
                verdict: 'locked',
                message: t('onboarding.pin.locked', { seconds }),
                lockSeconds: seconds,
              };
            }
            const left = LOCK_ATTEMPTS - ((await pinStore.attempts()) % LOCK_ATTEMPTS);
            return { verdict: 'wrong', message: t('pin.wrong.attempts', { left }) };
          }
        : undefined,
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
          : t('onboarding.pin.setSub', { bio: bioName(ctx.bio) })
      }
      value={val}
      setValue={setValue}
      message={locked ? t('onboarding.pin.locked', { seconds: lockLeft }) : msg}
      error={err}
      disabled={locked}
    />
  );
}
