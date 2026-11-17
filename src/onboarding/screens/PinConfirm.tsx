import React from 'react';
import type { Ctx } from '../context';
import { PinPad } from './PinPad';
import { usePinEntry } from '../ui';

export function PinConfirm({ ctx }: { ctx: Ctx }) {
  const { val, setValue, err, msg, lockLeft, locked } = usePinEntry({
    target: ctx.pin,
    onMatch: () => (ctx.pinOnly ? ctx.finish(false) : ctx.push(ctx.flow === 'create' ? 'seed' : 'import')),
  });

  return (
    <PinPad
      ctx={ctx}
      title="Confirm your PIN"
      subtitle="Re-enter the same 6 digits."
      value={val}
      setValue={setValue}
      message={locked ? `Too many attempts. Try again in ${lockLeft}s` : msg}
      error={err}
      disabled={locked}
    />
  );
}
