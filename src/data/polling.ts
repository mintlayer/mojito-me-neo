// Polling layer (spec M2): interval polling with exponential backoff on
// failures, pause on background and a single immediate refresh on foreground,
// plus the focus/pull-to-refresh scheduler seam. The timing core (PollCycle)
// and RefreshScheduler are pure and Node-testable with injected timers;
// usePoll is the thin React wrapper that binds AppState through a lazy
// require (react-native cannot load under the Node gate, where polling
// degrades to timer-only use).
import { useEffect, useRef } from 'react';
export type PollTimers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const defaultTimers: PollTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type PollCycleOptions = {
  intervalMs: number;
  backoff?: boolean;
  onError?: (error: unknown) => void;
  timers?: PollTimers;
};

const BACKOFF_MAX_FACTOR = 8;

/** Delay before the next tick after `consecutiveFailures` failures. */
export function pollDelayMs(intervalMs: number, consecutiveFailures: number, backoff: boolean): number {
  if (!backoff || consecutiveFailures <= 0) return intervalMs;
  const factor = Math.min(BACKOFF_MAX_FACTOR, 2 ** Math.min(consecutiveFailures, 30));
  return intervalMs * factor;
}

type PollState = 'stopped' | 'running' | 'paused';

export class PollCycle {
  private readonly fn: () => Promise<void>;

  private readonly intervalMs: number;

  private readonly backoff: boolean;

  private readonly onError?: (error: unknown) => void;

  private readonly timers: PollTimers;

  private state: PollState = 'stopped';

  private handle: unknown = null;

  private failures = 0;

  private inFlight = false;

  constructor(fn: () => Promise<void>, opts: PollCycleOptions) {
    this.fn = fn;
    this.intervalMs = opts.intervalMs;
    this.backoff = opts.backoff ?? false;
    this.onError = opts.onError;
    this.timers = opts.timers ?? defaultTimers;
  }

  /** Schedule the first tick after one interval; the screen's initial load
   *  stays the caller's job. */
  start(): void {
    if (this.state !== 'stopped') return;
    this.state = 'running';
    this.schedule(this.intervalMs);
  }

  /** Terminal: pending timers cancelled, resume does nothing afterwards. */
  stop(): void {
    this.cancelTimer();
    this.state = 'stopped';
  }

  /** Background: cancel the pending tick; failures reset so the foreground
   *  resume starts from the plain interval. */
  pause(): void {
    if (this.state !== 'running') return;
    this.cancelTimer();
    this.state = 'paused';
    this.failures = 0;
  }

  /** Foreground: one immediate refresh, then the interval resumes. */
  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'running';
    void this.tick();
  }

  /** Manual immediate refresh (pull-to-refresh), interval reschedules. */
  refreshNow(): Promise<void> {
    return this.tick();
  }

  private schedule(delayMs: number): void {
    this.cancelTimer();
    this.handle = this.timers.set(() => void this.tick(), delayMs);
  }

  private cancelTimer(): void {
    if (this.handle !== null) {
      this.timers.clear(this.handle);
      this.handle = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.state !== 'running' || this.inFlight) return;
    this.inFlight = true;
    try {
      await this.fn();
      this.failures = 0;
    } catch (e) {
      this.failures += 1;
      this.onError?.(e);
    } finally {
      this.inFlight = false;
    }
    if (this.state === 'running') this.schedule(pollDelayMs(this.intervalMs, this.failures, this.backoff));
  }
}

type Listener = () => void;

/** Focus-driven refresh seam: the shell reports events, screens subscribe. */
export class RefreshScheduler {
  private focusListeners: Listener[] = [];

  private pullListeners: Listener[] = [];

  onFocus(fn: Listener): void {
    this.focusListeners.push(fn);
  }

  onPullToRefresh(fn: Listener): void {
    this.pullListeners.push(fn);
  }

  focus(): void {
    for (const fn of this.focusListeners) fn();
  }

  pullToRefresh(): void {
    for (const fn of this.pullListeners) fn();
  }

  dispose(): void {
    this.focusListeners = [];
    this.pullListeners = [];
  }
}

type AppStateSubscription = { remove(): void };

type AppStateLike = {
  addEventListener(type: 'change', listener: (status: string) => void): AppStateSubscription;
};

function appState(): AppStateLike | null {
  try {
    // Lazy require: the react-native package cannot load under the Node gate.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require('react-native') as { AppState?: AppStateLike } | undefined;
    return rn?.AppState ?? null;
  } catch {
    return null;
  }
}

/**
 * Interval polling for screens: refreshes every intervalMs while active,
 * backs off on failures, pauses in background and resumes with a single
 * immediate refresh on foreground. `active: false` (locked session) stops
 * everything, so a re-locked wallet never fires network work.
 */
export function usePoll(
  fn: () => Promise<void>,
  opts: { intervalMs: number; backoff?: boolean; active?: boolean },
): void {
  const { intervalMs, backoff } = opts;
  const active = opts.active !== false;
  // The callback identity changes every render; the cycle keeps the latest.
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!active) return undefined;
    const cycle = new PollCycle(() => fnRef.current(), { intervalMs, backoff });
    cycle.start();
    const state = appState();
    let foreground = true;
    const subscription = state
      ? state.addEventListener('change', (status) => {
          if (status === 'background' && foreground) {
            foreground = false;
            cycle.pause();
          } else if (status === 'active' && !foreground) {
            foreground = true;
            cycle.resume();
          }
        })
      : null;
    return () => {
      subscription?.remove();
      cycle.stop();
    };
  }, [active, intervalMs, backoff]);
}
