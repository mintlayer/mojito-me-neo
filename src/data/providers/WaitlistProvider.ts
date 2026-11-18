// Waitlist provider selection (missing-architecture gap 4, decision R4).
// One factory, two implementations: the local-only store is the v1 default;
// the HTTP provider is complete against the proposed POST /v1/waitlist
// contract and activates with a config change only (endpoints.waitlistBase).
//
// TODO (SHIP BLOCKER, decision R4, 2026-11-17): v1 ships the waitlist
// LOCAL-ONLY. This MUST be replaced by a real backend (option A or B) before
// any production ship; the build must not ship to production with the
// local-only waitlist. Enforced in createWaitlistProvider: release
// construction without a configured waitlistBase refuses. See
// project decision log R4 and missing-architecture gap 4.
//
// Security note (spec M5): the email is personal data. It is stored sealed
// on device (src/data/mock/localWaitlist.ts), never logged, never sent
// anywhere except the configured waitlist endpoint, and redacted through
// maskEmail() in every status surface. No analytics exists and none may be
// added to this path.
import { assertHttpsBase, type FetchLike } from '../transport';
import { createLocalWaitlistProvider } from '../mock/localWaitlist';
import { FLAGS } from '../../config/endpoints';
import { devFallbackAllowed } from '../../config/runtime';
import { normalizeEmail } from '../../waitlist/WaitlistForm';
import type { EndpointsConfig } from '../../config/endpoints';
import type { WaitlistMemberStatus, WaitlistProvider, WaitlistResult } from './types';

export type HttpWaitlistOptions = {
  /** Waitlist API base (the gap 4 contract lives under {base}/v1/waitlist). */
  base: string;
  /** Injected transport for offline tests. */
  fetch?: FetchLike;
  /** Injected clock so tests pin the request timestamp. */
  now?: () => Date;
};

/** R4 ship blocker enforcement: a production build must never run the
 *  local-only waitlist, so release construction without a configured
 *  backend refuses instead of silently shipping the device-local store. */
export class LocalWaitlistShipBlockerError extends Error {
  constructor() {
    super('local-only waitlist refused in a release build: configure waitlistBase before ship (decision R4)');
    this.name = 'LocalWaitlistShipBlockerError';
  }
}

/**
 * Config-driven selection per gap 4: waitlistBase set means the HTTP
 * provider, unset (v1 default, R4) means the local-only store. Flipping to
 * the real backend is a URL change in src/config/endpoints.ts. The R4 ship
 * blocker is enforced here: while FLAGS.localWaitlistOnly holds, a build
 * where dev fallbacks are not allowed (a release build) refuses to
 * construct the local store.
 */
export function createWaitlistProvider(cfg: Pick<EndpointsConfig, 'waitlistBase'>): WaitlistProvider {
  if (cfg.waitlistBase) return createHttpWaitlistProvider({ base: cfg.waitlistBase });
  if (FLAGS.localWaitlistOnly && !devFallbackAllowed()) throw new LocalWaitlistShipBlockerError();
  return createLocalWaitlistProvider();
}

/** One attempt, 15s cap: a waitlist join is a single POST, not a chain read;
 *  retries are the user's retry button, which keeps double joins impossible. */
const TIMEOUT_MS = 15_000;

export function createHttpWaitlistProvider(opts: HttpWaitlistOptions): WaitlistProvider {
  assertHttpsBase(opts.base);
  const doFetch = opts.fetch ?? globalFetch;
  const now = opts.now ?? (() => new Date());

  const join = async (email: string): Promise<WaitlistResult> => {
    // Contract: POST /v1/waitlist { email, client, createdAt } -> 201
    // { position } | 200 { duplicate, position } | 400 { invalid_email } |
    // 503 { unavailable }. 200 duplicate is the idempotent success: the
    // address is already on the list.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await doFetch(`${opts.base}/v1/waitlist`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: normalizeEmail(email), client: 'mojito-mobile', createdAt: now().toISOString() }),
        signal: controller.signal,
      });
      if (response.status === 201 || response.status === 200) {
        const body = await safeJson(response);
        if (body === undefined) return { ok: false, reason: 'unavailable' };
        return { ok: true, position: positionOf(body) };
      }
      if (response.status === 400) return { ok: false, reason: 'invalid' };
      return { ok: false, reason: 'unavailable' };
    } catch {
      return { ok: false, reason: 'unavailable' };
    } finally {
      clearTimeout(timer);
    }
  };

  // Contract note: gap 4 defines no per-member status route (only the
  // optional GET /v1/waitlist/stats counter feed). Until the backend adds
  // one, the honest answer is a typed refusal, and the UI surfaces hide the
  // joined rows instead of fabricating a not-joined claim.
  const status = async (): Promise<WaitlistMemberStatus> => {
    throw new Error('waitlist status needs a backend member-status route (missing-architecture gap 4)');
  };

  // Contract note: gap 4 defines no removal route. v1 leave() is the local
  // wipe; with the HTTP provider there is no local state to wipe, so this
  // resolves without pretending the server forgot the address.
  const leave = async (): Promise<void> => undefined;

  return { join, status, leave };
}

function positionOf(body: unknown): number | null {
  if (body !== null && typeof body === 'object' && typeof (body as { position?: unknown }).position === 'number') {
    return (body as { position: number }).position;
  }
  return null;
}

/** A body that is not JSON answers unavailable, never a guessed result;
 *  undefined marks the parse failure (null is a legal JSON answer). */
async function safeJson(response: { text: () => Promise<string> }): Promise<unknown> {
  try {
    return JSON.parse(await response.text()) as unknown;
  } catch {
    return undefined;
  }
}

const globalFetch: FetchLike = typeof fetch === 'function' ? (fetch as unknown as FetchLike) : (() => {
  throw new Error('no fetch transport available');
});
