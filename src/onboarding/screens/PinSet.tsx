import React from 'react';
import type { Ctx } from '../context';
import { PinPad } from './PinPad';
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
      title="Create a PIN"
      subtitle={`6 digits. Unlocks the app when ${ctx.bio === 'face' ? 'Face ID' : 'your fingerprint'} isn't available.`}
      value={val}
      setValue={setValue}
    />
  );
}
