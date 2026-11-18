// Local-only waitlist store (missing-architecture gap 4, decision R4 option
// C): the email is personal data sealed at rest under the waitlist.email.v1
// key id through the sealed-blob store (SecureStore plus blob persistence),
// never logged, never sent anywhere, never in analytics (none exists; keep
// it that way).
//
// TODO (SHIP BLOCKER, decision R4, 2026-11-17): this LOCAL-ONLY provider
// MUST be replaced by a real backend (gap 4 option A or B) before any
// production ship; a production build must never run the local waitlist.
// See specs/M5-card.md and the provider selection in WaitlistProvider.ts.
//
// Semantics (spec M5): one waitlist slot per install. A second join of the
// address already on file succeeds idempotently with position null; a join
// of a different address is refused as duplicate and the stored email stays
// on file for the masked duplicate callout; leave() wipes the key id and
// the blob so persistence stays user-controlled.
import { WAITLIST } from '../../data';
import { getBlobStore } from '../../storage/blobStore';
import { STORAGE_KEYS } from '../../storage/keys';
import { getSecureStore } from '../../storage/secureStore';
import { checkEmail, normalizeEmail } from '../../waitlist/WaitlistForm';
import type { WaitlistMemberStatus, WaitlistProvider, WaitlistResult, WaitlistStatus } from '../providers/types';

const KEY = STORAGE_KEYS.waitlistEmail;

export type LocalWaitlistEntry = { email: string; joinedAt: string; position: number };

function encodeEntry(entry: LocalWaitlistEntry): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(entry));
}

function decodeEntry(bytes: Uint8Array): LocalWaitlistEntry | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<LocalWaitlistEntry>;
    if (typeof parsed.email === 'string' && typeof parsed.joinedAt === 'string' && typeof parsed.position === 'number') {
      return { email: parsed.email, joinedAt: parsed.joinedAt, position: parsed.position };
    }
  } catch {
    // corrupt JSON falls through to not-joined
  }
  return null;
}

async function loadEntry(): Promise<LocalWaitlistEntry | null> {
  const { store } = await getSecureStore();
  const { store: blobs } = await getBlobStore();
  const blob = await blobs.get(KEY);
  if (!blob) return null;
  try {
    return decodeEntry(await store.open(KEY, blob));
  } catch {
    // A sealed row that no longer opens (key rotated, tampered, stale) reads
    // as not joined; leave() can still wipe the leftover blob.
    return null;
  }
}

async function saveEntry(entry: LocalWaitlistEntry): Promise<void> {
  const { store } = await getSecureStore();
  const { store: blobs } = await getBlobStore();
  // Ungated seal: a marketing form must not fire a biometric prompt mid-join
  // (same policy as the PIN verifier in storage/pinStore.ts; the at-rest
  // protection is the OS-resident key, not the user gate).
  const blob = await store.seal(KEY, encodeEntry(entry), false);
  await blobs.set(KEY, blob);
}

/**
 * The taken counter as provider state (spec M5): the fixture seed from
 * data.ts plus one while this install holds its slot, so the Card gauge
 * reflects a local join and falls back to the seed after a leave.
 */
export async function localWaitlistCounter(): Promise<WaitlistStatus> {
  const entry = await loadEntry();
  return { taken: WAITLIST.taken + (entry ? 1 : 0), total: WAITLIST.total };
}

export function createLocalWaitlistProvider(): WaitlistProvider {
  const join = async (email: string): Promise<WaitlistResult> => {
    const normalized = normalizeEmail(email);
    if (checkEmail(normalized) === 'invalid') {
      return { ok: false, reason: 'invalid' };
    }
    const entry = await loadEntry();
    if (entry) {
      return entry.email === normalized
        ? { ok: true, position: null } // idempotent rejoin: no new position
        : { ok: false, reason: 'duplicate' }; // one slot per install
    }
    const next: LocalWaitlistEntry = {
      email: normalized,
      joinedAt: new Date().toISOString(),
      position: WAITLIST.taken + 1,
    };
    await saveEntry(next);
    return { ok: true, position: next.position };
  };

  const status = async (): Promise<WaitlistMemberStatus> => {
    const entry = await loadEntry();
    return entry
      ? { joined: true, email: entry.email, position: entry.position }
      : { joined: false, email: null, position: null };
  };

  const leave = async (): Promise<void> => {
    const { store } = await getSecureStore();
    const { store: blobs } = await getBlobStore();
    await blobs.remove(KEY);
    await store.wipe(KEY);
  };

  return { join, status, leave };
}
