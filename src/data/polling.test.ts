// Polling gate: PollCycle scheduling, backoff growth and cap, pause/resume
// with the immediate foreground refresh, stop semantics, and the
// RefreshScheduler fan-out. All deterministic through injected timers.
//   npx tsx src/data/polling.test.ts
import { strict as assert } from 'node:assert/strict';

import { PollCycle, RefreshScheduler, jitterMs, pollDelayMs } from './polling';

/** Deterministic scheduling in the delay assertions below: the production
 *  default adds +-10% jitter, the tests pin the exact base delays. */
const identityJitter = (ms: number): number => ms;

/** Manual clock: queued timers fire explicitly, delays are recorded. */
function manualTimers() {
  const queue: { fn: () => void; ms: number; handle: number }[] = [];
  let nextHandle = 1;
  return {
    timers: {
      set: (fn: () => void, ms: number) => {
        const handle = nextHandle++;
        queue.push({ fn, ms, handle });
        return handle;
      },
      clear: (handle: unknown) => {
        const index = queue.findIndex((entry) => entry.handle === handle);
        if (index >= 0) queue.splice(index, 1);
      },
    },
    fireNext: (): void => {
      const entry = queue.shift();
      if (!entry) throw new Error('no scheduled timer');
      entry.fn();
    },
    pendingDelay: (): number | null => (queue.length > 0 ? queue[0].ms : null),
    get size(): number {
      return queue.length;
    },
  };
}

async function main() {
  // Delay curve: backoff doubles per consecutive failure, capped at 8x.
  assert.equal(pollDelayMs(1000, 0, true), 1000);
  assert.equal(pollDelayMs(1000, 1, true), 2000);
  assert.equal(pollDelayMs(1000, 2, true), 4000);
  assert.equal(pollDelayMs(1000, 3, true), 8000);
  assert.equal(pollDelayMs(1000, 9, true), 8000);
  assert.equal(pollDelayMs(1000, 2, false), 1000);

  // Jitter: +-10% around the delay, driven by the injected random.
  assert.equal(jitterMs(1000, () => 0), 900);
  assert.equal(jitterMs(1000, () => 1), 1100);
  assert.equal(jitterMs(1000, () => 0.5), 1000);
  assert.equal(jitterMs(70_000, () => 0.25), 66_500);
  {
    const clock = manualTimers();
    const cycle = new PollCycle(async () => undefined, {
      intervalMs: 100,
      timers: clock.timers,
      jitter: (ms) => ms * 2,
    });
    cycle.start();
    assert.equal(clock.pendingDelay(), 200);
    cycle.stop();
  }

  // Success loop: fires the fn every interval, no backoff on success.
  {
    const clock = manualTimers();
    let runs = 0;
    const cycle = new PollCycle(async () => {
      runs += 1;
    }, { intervalMs: 100, timers: clock.timers, jitter: identityJitter });
    cycle.start();
    assert.equal(clock.pendingDelay(), 100);
    clock.fireNext();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(runs, 1);
    assert.equal(clock.pendingDelay(), 100);
    cycle.stop();
    assert.equal(clock.size, 0);
  }

  // Failures grow the delay, success resets it.
  {
    const clock = manualTimers();
    let fail = true;
    const cycle = new PollCycle(async () => {
      if (fail) throw new Error('down');
    }, { intervalMs: 100, backoff: true, timers: clock.timers, jitter: identityJitter });
    cycle.start();
    clock.fireNext();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(clock.pendingDelay(), 200);
    clock.fireNext();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(clock.pendingDelay(), 400);
    fail = false;
    clock.fireNext();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(clock.pendingDelay(), 100);
    cycle.stop();
  }

  // pause cancels the pending tick; resume fires immediately once.
  {
    const clock = manualTimers();
    let runs = 0;
    const cycle = new PollCycle(async () => {
      runs += 1;
    }, { intervalMs: 100, timers: clock.timers, jitter: identityJitter });
    cycle.start();
    cycle.pause();
    assert.equal(clock.size, 0);
    cycle.resume();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(runs, 1);
    assert.equal(clock.pendingDelay(), 100);
    cycle.stop();
  }

  // Stop is terminal: resume after stop does nothing.
  {
    const clock = manualTimers();
    let runs = 0;
    const cycle = new PollCycle(async () => {
      runs += 1;
    }, { intervalMs: 50, timers: clock.timers, jitter: identityJitter });
    cycle.start();
    cycle.stop();
    cycle.resume();
    await Promise.resolve();
    assert.equal(runs, 0);
    assert.equal(clock.size, 0);
  }

  // refreshNow fires without waiting for the interval and reschedules.
  {
    const clock = manualTimers();
    let runs = 0;
    const cycle = new PollCycle(async () => {
      runs += 1;
    }, { intervalMs: 100, timers: clock.timers, jitter: identityJitter });
    cycle.start();
    await cycle.refreshNow();
    assert.equal(runs, 1);
    assert.equal(clock.pendingDelay(), 100);
    cycle.stop();
  }

  // In-flight ticks never double-fire while a resume lands mid-flight.
  {
    const clock = manualTimers();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let runs = 0;
    const cycle = new PollCycle(() => {
      runs += 1;
      return gate;
    }, { intervalMs: 100, timers: clock.timers, jitter: identityJitter });
    cycle.start();
    clock.fireNext();
    assert.equal(runs, 1);
    cycle.pause();
    cycle.resume();
    // The in-flight tick is still running; resume's immediate tick must be
    // swallowed, and no second run happens until the first resolves.
    await Promise.resolve();
    assert.equal(runs, 1);
    release();
    await Promise.resolve();
    await Promise.resolve();
    // The resolved tick scheduled the next one at the plain interval.
    assert.equal(clock.pendingDelay(), 100);
    clock.fireNext();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(runs, 2);
    cycle.stop();
  }

  // RefreshScheduler fans out to subscribers and dispose clears them.
  {
    const scheduler = new RefreshScheduler();
    let focus = 0;
    let pull = 0;
    scheduler.onFocus(() => {
      focus += 1;
    });
    scheduler.onPullToRefresh(() => {
      pull += 1;
    });
    scheduler.focus();
    scheduler.pullToRefresh();
    assert.equal(focus, 1);
    assert.equal(pull, 1);
    scheduler.dispose();
    scheduler.focus();
    scheduler.pullToRefresh();
    assert.equal(focus, 1);
    assert.equal(pull, 1);
  }

  console.log('polling: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
