import React, { useState, useEffect, useRef } from 'react';
import type { Ctx } from '../context';
import { PinPad } from './PinPad';

export function PinSet({ ctx }: { ctx: Ctx }) {
  const [val, setVal] = useState('');
  // ctx is rebuilt every render of <Onboarding>, so depending on it would
  // re-fire this effect constantly. A ref keeps the closure fresh instead.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  useEffect(() => {
    if (val.length !== 6) return;
    const t = setTimeout(() => {
      ctxRef.current.setPin(val);
      ctxRef.current.push('pin-confirm');
    }, 250);
    return () => clearTimeout(t);
  }, [val]);

  return (
    <PinPad
      ctx={ctx}
      title="Create a PIN"
      subtitle={`6 digits. Unlocks the app when ${ctx.bio === 'face' ? 'Face ID' : 'your fingerprint'} isn't available.`}
      value={val}
      setValue={setVal}
    />
  );
}
