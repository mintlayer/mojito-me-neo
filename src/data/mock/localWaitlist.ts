// Local-only waitlist (R4, option C): device persistence plus confirmation
// state, idempotent per email. The real backend MUST replace this before any
// production ship; the ship-blocking TODO lives in missing-architecture gap 4.
import { WAITLIST } from '../../data';
import type { WaitlistMemberStatus, WaitlistProvider, WaitlistResult } from '../providers/types';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export function createLocalWaitlistProvider(): WaitlistProvider {
  // Session-scoped membership set. M5 swaps in secure persistence under
  // STORAGE_KEYS.waitlistEmail; the call sites do not change.
  const members = new Set<string>();
  let nextPosition = WAITLIST.taken + 1;

  const join = async (email: string): Promise<WaitlistResult> => {
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalized) || normalized.length > 254) {
      return { ok: false, reason: 'invalid' };
    }
    if (members.has(normalized)) {
      return { ok: false, reason: 'duplicate' };
    }
    members.add(normalized);
    return { ok: true, position: nextPosition++ };
  };

  const status = async (): Promise<WaitlistMemberStatus> => {
    const joined = members.size > 0;
    return joined
      ? { joined: true, email: [...members][members.size - 1], position: nextPosition - 1 }
      : { joined: false, email: null, position: null };
  };

  const leave = async (): Promise<void> => {
    members.clear();
    nextPosition = WAITLIST.taken + 1;
  };

  return { join, status, leave };
}
