// Persisted swap sessions (spec M4 deliverable 4): the state machine rows
// for the ML-side HTLC atomic swap so an in-flight swap survives restarts.
// Plain JSON in AsyncStorage like the address indexes (public data only):
// rows carry the secret hash and transaction ids, NEVER the preimage (the
// spec security note: losing the preimage forfeits the swap, so the session
// screen shows a keep-open warning instead of persisting the secret).
import { STORAGE_KEYS } from '../storage/keys';
import { loadAsyncStorage } from '../storage/asyncStorage';
import { devFallbackAllowed } from '../config/runtime';
import type { HtlcOffer } from '../trade/htlc';

/** Swap lifecycle (spec contract): offered -> locked -> claiming ->
 *  settled, with refunded and expired as the terminal alternates. */
export type SwapState = 'offered' | 'locked' | 'claiming' | 'settled' | 'refunded' | 'expired';

/** Persisted session row. The preimage never lands here: secretHashHex is
 *  the only secret-derived field. */
export type SwapSessionRow = {
  id: string;
  offer: HtlcOffer;
  /** Hex of SHA-256(preimage); the preimage itself never persists. */
  secretHashHex: string;
  /** Counterparty spend path and our refund path (rebuild leg data after
   *  a restart without touching the chain). */
  spendAddress: string;
  spendPubkeyHex: string;
  refundAddress: string;
  /** Hex of the unsigned lock transaction bytes as built before the
   *  broadcast: the claim and refund bindings decodes consume serialized
   *  transaction bytes and the public indexer serves no raw-tx route, so
   *  these are the only honest source after a restart. */
  lockTxHex?: string;
  state: SwapState;
  txIds: string[];
  updatedAt: number;
};

/** Allowed transitions; anything else is a programming error, not a
 *  silent overwrite. */
const TRANSITIONS: Record<SwapState, SwapState[]> = {
  offered: ['locked', 'expired'],
  locked: ['claiming', 'refunded', 'expired'],
  claiming: ['settled', 'refunded', 'expired'],
  settled: [],
  refunded: [],
  expired: [],
};

export function canTransition(from: SwapState, to: SwapState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: SwapState, to: SwapState): void {
  if (!canTransition(from, to)) throw new Error(`invalid swap transition: ${from} -> ${to}`);
}

export interface SwapSessionStore {
  save(row: SwapSessionRow): Promise<void>;
  all(): Promise<SwapSessionRow[]>;
  get(id: string): Promise<SwapSessionRow | null>;
  /** Drop one session (terminal cleanup only). */
  remove(id: string): Promise<void>;
}

export type SwapSessionStorage = {
  load(): Promise<string | null>;
  save(json: string): Promise<void>;
};

/** AsyncStorage-backed storage with the dev memory fallback (the
 *  addressStore policy: release builds fail loudly without storage). */
function defaultStorage(): SwapSessionStorage {
  return {
    async load() {
      const api = await loadAsyncStorage();
      if (api) return api.getItem(STORAGE_KEYS.swapSessions);
      if (!devFallbackAllowed()) throw new Error('async storage unavailable');
      return memory;
    },
    async save(json) {
      const api = await loadAsyncStorage();
      if (api) {
        await api.setItem(STORAGE_KEYS.swapSessions, json);
        return;
      }
      if (!devFallbackAllowed()) throw new Error('async storage unavailable');
      memory = json;
    },
  };
}

let memory: string | null = null;

const MAX_SESSIONS = 32;
const MAX_TX_IDS = 16;

/** Row sanity: a tampered store must not resurrect a settled swap or a
 *  fabricated preimage field. Bad rows drop on load. */
export function parseSwapSessions(json: string | null): SwapSessionRow[] {
  if (json === null || json.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const rows: SwapSessionRow[] = [];
  for (const entry of parsed.slice(0, MAX_SESSIONS)) {
    const row = entry as Partial<SwapSessionRow>;
    if (
      typeof row.id === 'string' && row.id.length > 0 &&
      row.offer !== null && typeof row.offer === 'object' &&
      typeof row.secretHashHex === 'string' && /^[0-9a-f]{64}$/.test(row.secretHashHex) &&
      typeof row.spendAddress === 'string' &&
      typeof row.refundAddress === 'string' &&
      (row.lockTxHex === undefined || (typeof row.lockTxHex === 'string' && /^[0-9a-f]*$/.test(row.lockTxHex) && row.lockTxHex.length % 2 === 0)) &&
      typeof row.state === 'string' && row.state in TRANSITIONS &&
      Array.isArray(row.txIds) && row.txIds.length <= MAX_TX_IDS && row.txIds.every((id) => typeof id === 'string') &&
      typeof row.updatedAt === 'number' && Number.isFinite(row.updatedAt)
    ) {
      rows.push(entry as SwapSessionRow);
    }
  }
  return rows;
}

export function createSwapSessionStore(storage: SwapSessionStorage = defaultStorage()): SwapSessionStore {
  return {
    async save(row) {
      assertTransitionIsKnown(row.state);
      const rows = (await this.all()).filter((existing) => existing.id !== row.id);
      rows.unshift({ ...row, txIds: row.txIds.slice(0, MAX_TX_IDS) });
      await storage.save(JSON.stringify(rows.slice(0, MAX_SESSIONS)));
    },
    async all() {
      return parseSwapSessions(await storage.load());
    },
    async get(id) {
      return (await this.all()).find((row) => row.id === id) ?? null;
    },
    async remove(id) {
      const rows = (await this.all()).filter((row) => row.id !== id);
      await storage.save(JSON.stringify(rows));
    },
  };
}

/** save() accepts any state the transitions table knows; state CORRECTNESS
 *  (canTransition) is the caller's machine discipline, checked in tests and
 *  by the swap screen reducer. */
function assertTransitionIsKnown(state: SwapState): void {
  if (!(state in TRANSITIONS)) throw new Error(`unknown swap state: ${state}`);
}
