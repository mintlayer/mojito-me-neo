import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import { LOCK_ATTEMPTS, LOCK_SECONDS } from '../context';
import { pinStore } from '../../storage/pinStore';

export type PinVerdict = {
  verdict: 'ok' | 'wrong' | 'locked';
  message?: string;
  lockSeconds?: number;
};

/**
 * Store-backed verdict for usePinEntry's check, shared by the app lock, the
 * Settings disable step-up and the change-PIN old-PIN verify so the lockout
 * bookkeeping behaves identically in all of them. 'unset' (no PIN row) fails
 * closed without feeding the lockout: there is no verifier the lockout could
 * ever be cleared against. `unsetCopy` overrides the message for that verdict
 * in contexts where "unlock failed" reads wrong (change PIN, step-up).
 */
export function pinEntryCheck(opts?: { unsetCopy?: string }): (pin: string) => Promise<PinVerdict> {
  const unsetCopy = opts?.unsetCopy ?? t('onboarding.unlock.failed');
  return async (pin) => {
    const verdict = await pinStore.verify(pin);
    if (verdict === 'ok') return { verdict: 'ok' };
    if (verdict === 'locked') {
      const seconds = await pinStore.lockSecondsLeft();
      return { verdict: 'locked', message: t('onboarding.pin.locked', { seconds }), lockSeconds: seconds };
    }
    if (verdict === 'unset') return { verdict: 'wrong', message: unsetCopy };
    await pinStore.registerFailure();
    const seconds = await pinStore.lockSecondsLeft();
    if (seconds > 0) {
      return { verdict: 'locked', message: t('onboarding.pin.locked', { seconds }), lockSeconds: seconds };
    }
    const left = LOCK_ATTEMPTS - ((await pinStore.attempts()) % LOCK_ATTEMPTS);
    return {
      verdict: 'wrong',
      message: t('onboarding.pin.wrongAttempts', { left }),
    };
  };
}

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
  check,
  checkFailureCopy,
  resetKey,
}: {
  /** Expected PIN. null collects six digits and always matches (PIN set).
   *  Ignored when `check` is given: the verdict comes back asynchronously. */
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
  /** Store-backed verdict (UnlockScreen, change-PIN old-PIN check). */
  check?: (pin: string) => Promise<{
    verdict: 'ok' | 'wrong' | 'locked';
    message?: string;
    lockSeconds?: number;
  }>;
  /** Copy for a thrown check (storage failure). Defaults to the unlock
   *  failure line; non-unlock contexts pass the neutral verify copy. */
  checkFailureCopy?: string;
  /** Changing this value clears the entry: used when one screen runs two
   *  entry phases back to back (change-PIN old verify, then new collect). */
  resetKey?: string;
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
  const cbs = useRef({ onMatch, onMismatch, check, checkFailureCopy });
  useEffect(() => {
    cbs.current = { onMatch, onMismatch, check, checkFailureCopy };
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
    // Store-backed mode: the verdict arrives asynchronously and carries its
    // own message and lock duration; attempts still decrement locally.
    if (cbs.current.check) {
      let cancelled = false;
      void cbs.current
        .check(val)
        .then((result) => {
          if (cancelled) return;
          if (result.verdict === 'ok') {
            setTimeout(() => cbs.current.onMatch(val), settle);
            return;
          }
          const left = attempts - 1;
          setErr(true);
          setMsg(result.message ?? t('onboarding.pin.mismatch'));
          setAttempts(left);
          if (result.verdict === 'locked' || left <= 0) {
            setLockLeft(result.lockSeconds ?? lockSeconds);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setErr(true);
            setMsg(cbs.current.checkFailureCopy ?? t('onboarding.unlock.failed'));
          }
        });
      return () => {
        cancelled = true;
      };
    }
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

  // Re-arm from persisted state (a lock armed in a previous app run): the
  // countdown resumes exactly where pinStore left it.
  const armLock = useCallback((seconds: number) => {
    if (seconds > 0) setLockLeft(seconds);
  }, []);

  // Phase switches clear the dots; the deferred-clear effect must not fight
  // this, so the clear is unconditional on the key change.
  useEffect(() => {
    setValRaw('');
    setErr(false);
    setMsg('');
  }, [resetKey]);

  return { val, setValue, err, msg, lockLeft, locked, armLock };
}
