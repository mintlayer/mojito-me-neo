import React, { useState, useEffect, useRef } from 'react';
import type { Ctx } from '../context';
import { PinPad } from './PinPad';

export function PinConfirm({ ctx }: { ctx: Ctx }) {
  const [val, setVal] = useState('');
  const [err, setErr] = useState(false);
  const [msg, setMsg] = useState('');
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  useEffect(() => {
    if (val.length !== 6) return;
    const c = ctxRef.current;
    if (val === c.pin) {
      const t = setTimeout(() => (c.pinOnly ? c.finish(false) : c.push(c.flow === 'create' ? 'seed' : 'import')), 250);
      return () => clearTimeout(t);
    }
    setErr(true);
    setMsg("PINs don't match — try again");
    const t = setTimeout(() => {
      setVal('');
      setErr(false);
    }, 650);
    return () => clearTimeout(t);
  }, [val]);

  return (
    <PinPad
      ctx={ctx}
      title="Confirm your PIN"
      subtitle="Re-enter the same 6 digits."
      value={val}
      setValue={(v) => {
        setMsg('');
        setVal(v);
      }}
      message={msg}
      error={err}
    />
  );
}

/* ══ 3a · Seed reveal ═══════════════════════════════════════ */
