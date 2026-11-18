// Pending to confirmed lifecycle (spec M3 deliverable 8): a small poll
// loop per tracked transaction id writing into a typed store; screens
// subscribe and re-render, and a state change also nudges the home refresh
// so the activity list (which reads the chain, the source of truth) picks
// the transaction up. The tracker never fabricates confirmations: the
// states come from BroadcastProvider status reads only.
//
// Polling policy: fixed interval (default 12 s, deliberately faster than
// the 60 s home cycle because a just-broadcast transaction settles within
// seconds), capped attempts, stop on confirmed or not-found, swallow
// per-tick failures until the cap (a flaky read must not kill tracking),
// injected timers for deterministic tests.
import type { BroadcastProvider, TxStatusInfo } from '../data/providers/types';
import type { PollTimers } from '../data/polling';

export type TrackedChain = 'ml' | 'btc';

export type TrackedTx = {
  id: string;
  chain: TrackedChain;
  state: TxStatusInfo['state'];
  confirmations: number | null;
  blockId: string | null;
};

export type TxTrackerOptions = {
  pollMs?: number;
  maxAttempts?: number;
  confirmationsTarget?: number;
  timers?: PollTimers;
};

const DEFAULT_POLL_MS = 12_000;
const DEFAULT_MAX_ATTEMPTS = 150;
const DEFAULT_CONFIRMATIONS_TARGET = 12;

const defaultTimers: PollTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

type Entry = TrackedTx & { attempts: number; handle: unknown | null; target: number };

export class TxTracker {
  private readonly entries = new Map<string, Entry>();

  private readonly listeners = new Set<() => void>();

  private readonly pollMs: number;

  private readonly maxAttempts: number;

  private readonly defaultTarget: number;

  private readonly timers: PollTimers;

  constructor(
    private readonly provider: Pick<BroadcastProvider, 'getMlStatus' | 'getBtcStatus'>,
    opts?: TxTrackerOptions,
  ) {
    this.pollMs = opts?.pollMs ?? DEFAULT_POLL_MS;
    this.maxAttempts = opts?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.defaultTarget = opts?.confirmationsTarget ?? DEFAULT_CONFIRMATIONS_TARGET;
    this.timers = opts?.timers ?? defaultTimers;
  }

  /** Track one transaction; re-tracking an id refreshes its target. */
  track(tx: { id: string; chain: TrackedChain }, opts?: { confirmationsTarget?: number }): void {
    const key = `${tx.chain}:${tx.id}`;
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      existing.target = opts?.confirmationsTarget ?? this.defaultTarget;
      this.notify();
      return;
    }
    const entry: Entry = {
      id: tx.id,
      chain: tx.chain,
      state: 'pending',
      confirmations: null,
      blockId: null,
      attempts: 0,
      handle: null,
      target: opts?.confirmationsTarget ?? this.defaultTarget,
    };
    this.entries.set(key, entry);
    this.notify();
    this.schedule(entry);
  }

  /** Current tracked state, or null for untracked ids. */
  get(chain: TrackedChain, id: string): TrackedTx | null {
    const entry = this.entries.get(`${chain}:${id}`);
    if (entry === undefined) return null;
    return { id: entry.id, chain: entry.chain, state: entry.state, confirmations: entry.confirmations, blockId: entry.blockId };
  }

  /** Subscribe to any state change; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Stop every poll loop (network switch, unmount). */
  stopAll(): void {
    for (const entry of this.entries.values()) {
      if (entry.handle !== null) {
        this.timers.clear(entry.handle);
        entry.handle = null;
      }
    }
  }

  private schedule(entry: Entry): void {
    if (entry.handle !== null) return;
    entry.handle = this.timers.set(() => {
      entry.handle = null;
      void this.tick(entry);
    }, this.pollMs);
  }

  private async tick(entry: Entry): Promise<void> {
    entry.attempts += 1;
    try {
      const status = entry.chain === 'ml' ? await this.provider.getMlStatus(entry.id) : await this.provider.getBtcStatus(entry.id);
      const changed = status.state !== entry.state || (status.confirmations ?? null) !== entry.confirmations;
      entry.state = status.state;
      entry.confirmations = status.confirmations ?? null;
      entry.blockId = status.blockId ?? null;
      if (changed) this.notify();
    } catch {
      // Flaky read: keep polling until the attempt cap, never surface raw
      // transport text here; the chain history remains the source of truth.
    }
    if (entry.state === 'not-found' || entry.attempts >= this.maxAttempts) {
      // Terminal or stalled: stop the loop, keep the last known state.
      return;
    }
    this.schedule(entry);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
