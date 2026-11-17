import React from 'react';
import { t } from '../../i18n';
import type { Ctx } from '../context';
import { PinPad } from './PinPad';
import { bioName } from '../context';
import { usePinEntry } from '../ui';

export function PinSet({ ctx }: { ctx: Ctx }) {
  const { val, setValue } = usePinEntry({
    target: null,
    onMatch: (pin) => {
      ctx.setPin(pin);
      ctx.push('pin-confirm');
    },
  });

  return (
    <PinPad
      ctx={ctx}
      title={t('onboarding.pin.set')}
      subtitle={t('onboarding.pin.setSub', { bio: bioName(ctx.bio) })}
      value={val}
      setValue={setValue}
    />
  );
}
