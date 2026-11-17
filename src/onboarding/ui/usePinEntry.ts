import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import { LOCK_ATTEMPTS, LOCK_SECONDS } from '../context';

/**
 * Shared PIN-entry sequencing: collect six digits, settle briefly, then fire
 * `onMatch`. On a mismatch, show a message, reset, and (for the app lock)
 * count attempts down into a lockout. PinSet, PinConfirm and UnlockScreen
 * used to be three copies of this effect with the same cadence.
 */
export function usePinEntry({
  target,
  onMatch,
  onMismatch,
  settle = 250,
  reset = 650,
  maxAttempts = LOCK_ATTEMPTS,
  lockSeconds = LOCK_SECONDS,
}: {
  /** Expected PIN. null collects six digits and always matches (PIN set). */
  target: string | null;
  onMatch: (pin: string) => void;
  /** Message shown on a mismatch; the default covers simple re-entry. */
  onMismatch?: (attemptsLeft: number) => string;
  /** Dwell between the sixth digit and advancing. */
  settle?: number;
  /** How long the error copy shows before the field clears. */
  reset?: number;
  maxAttempts?: number;
  lockSeconds?: number;
}) {
  const [val, setValRaw] = useState('');
  const [err, setErr] = useState(false);
  const [msg, setMsg] = useState('');
  const [attempts, setAttempts] = useState(maxAttempts);
  const [lockLeft, setLockLeft] = useState(0);
  const locked = lockLeft > 0;

  // The callbacks close over the caller's current state, so their identity
  // changes every render. Keeping them in a ref lets the effects below depend
  // on values only, same reason PinSet used a ctxRef.
  const cbs = useRef({ onMatch, onMismatch });
  useEffect(() => {
    cbs.current = { onMatch, onMismatch };
  });

  // Lockout countdown; hitting zero also restores the attempt budget.
  useEffect(() => {
    if (lockLeft <= 0) return;
    const t = setTimeout(() => {
      const next = lockLeft - 1;
      setLockLeft(next);
      if (next === 0) {
        setAttempts(maxAttempts);
        setMsg('');
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [lockLeft, maxAttempts]);

  // Edits are swallowed while a mismatch is on screen or a lock is armed: a
  // backspace must not be able to dispose of the failed entry before its
  // attempt has been counted and its visual clear has landed.
  const setValue = useCallback(
    (v: string) => {
      if (err || locked) return;
      setMsg('');
      setValRaw(v);
    },
    [err, locked],
  );

  useEffect(() => {
    if (err || locked || val.length !== 6) return;
    if (target === null || val === target) {
      const t = setTimeout(() => cbs.current.onMatch(val), settle);
      return () => clearTimeout(t);
    }
    // Mismatch. The attempt decrement and lock arming happen right here, not
    // inside a timer, so no amount of typing or deleting can cancel them.
    // Only the visual clear is deferred, and it lives in the effect below.
    const left = attempts - 1;
    setErr(true);
    setMsg(cbs.current.onMismatch ? cbs.current.onMismatch(left) : t('onboarding.pin.mismatch'));
    setAttempts(left);
    if (left <= 0) setLockLeft(lockSeconds);
  }, [val, locked, err, target, attempts, settle, lockSeconds]);

  // Deferred visual clear for a mismatch. Keyed on `err` alone so a lock
  // arming mid-window (final attempt) cannot cancel it either.
  useEffect(() => {
    if (!err) return;
    const t = setTimeout(() => {
      setValRaw('');
      setErr(false);
    }, reset);
    return () => clearTimeout(t);
  }, [err, reset]);

  return { val, setValue, err, msg, lockLeft, locked };
}
