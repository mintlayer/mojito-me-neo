// TxTracker gate (spec M3 deliverable 8): pending to confirmed transition
// with notify-on-change, terminal stop, attempt cap on flaky reads, and
// re-track refresh. Offline: scripted status provider plus manual timers.
//   tsx src/send/TxTracker.test.ts
import { strict as assert } from 'node:assert/strict';

import { TxTracker } from './TxTracker';
import type { TxStatusInfo } from '../data/providers/types';
import type { PollTimers } from '../data/polling';

const noop = (): void => undefined;

function manualTimers(): PollTimers & { run: () => Promise<void>; pending: () => number } {
  const queue: (() => void)[] = [];
  return {
    set: (fn: () => void) => {
      queue.push(fn);
      return queue.length;
    },
    clear: (handle: unknown) => {
      const index = (handle as number) - 1;
      if (index >= 0 && index < queue.length) queue[index] = noop;
    },
    pending: () => queue.filter((fn) => fn !== noop).length,
    run: async () => {
      const current = queue.splice(0);
      for (const fn of current) fn();
      await Promise.resolve();
    },
  };
}

/** Scripted status source: a queue per chain, then the last answer repeats. */
function scriptedProvider(ml: TxStatusInfo[], btc: TxStatusInfo[] = []): {
  getMlStatus(id: string): Promise<TxStatusInfo>;
  getBtcStatus(id: string): Promise<TxStatusInfo>;
} {
  return {
    getMlStatus: async () => (ml.length > 1 ? (ml.shift() as TxStatusInfo) : ml[0]),
    getBtcStatus: async () => (btc.length > 1 ? (btc.shift() as TxStatusInfo) : btc[0]),
  };
}

async function main() {
  // 1. Pending flips to confirmed with a notification and the loop stops.
  {
    const timers = manualTimers();
    const tracker = new TxTracker(scriptedProvider([{ state: 'pending' }, { state: 'confirmed', blockId: 'bb'.repeat(32), confirmations: 1 }]), {
      timers,
      pollMs: 100,
    });
    let notifications = 0;
    tracker.subscribe(() => {
      notifications += 1;
    });
    tracker.track({ id: 'tx1', chain: 'ml' });
    assert.deepEqual(tracker.get('ml', 'tx1'), { id: 'tx1', chain: 'ml', state: 'pending', confirmations: null, blockId: null });
    const afterTrack = notifications;
    assert.ok(afterTrack >= 1, 'registration notifies');
    // Tick one answers pending (no change), tick two confirms.
    await timers.run();
    await timers.run();
    assert.equal(tracker.get('ml', 'tx1')?.state, 'confirmed');
    assert.equal(tracker.get('ml', 'tx1')?.confirmations, 1);
    assert.equal(tracker.get('ml', 'tx1')?.blockId, 'bb'.repeat(32));
    assert.ok(notifications > afterTrack, 'state change notifies');
    // Terminal: no further timer scheduled, so a second run is a no-op.
    const mid = notifications;
    await timers.run();
    assert.equal(notifications, mid);
    assert.deepEqual(tracker.get('ml', 'tx1'), { id: 'tx1', chain: 'ml', state: 'confirmed', confirmations: 1, blockId: 'bb'.repeat(32) });
  }

  // 2. Flaky reads are swallowed until the attempt cap, then the loop stops
  //    with the last known state kept.
  {
    const timers = manualTimers();
    let failures = 0;
    const tracker = new TxTracker(
      {
        getMlStatus: async () => {
          failures += 1;
          throw new Error('connection refused');
        },
        getBtcStatus: async () => ({ state: 'pending' }),
      },
      { timers, pollMs: 10, maxAttempts: 3 },
    );
    tracker.track({ id: 'tx2', chain: 'ml' });
    await timers.run();
    await timers.run();
    await timers.run();
    assert.equal(failures, 3, 'three attempts, not one');
    assert.equal(tracker.get('ml', 'tx2')?.state, 'pending', 'state kept through failures');
    await timers.run();
    assert.equal(failures, 3, 'loop stops at the cap');
  }

  // 3. not-found is terminal; untracked ids answer null; re-tracking is a
  //    refresh, not a duplicate loop.
  {
    const timers = manualTimers();
    const tracker = new TxTracker(scriptedProvider([{ state: 'not-found' }]), { timers });
    assert.equal(tracker.get('ml', 'ghost'), null);
    tracker.track({ id: 'tx3', chain: 'ml' });
    tracker.track({ id: 'tx3', chain: 'ml' }, { confirmationsTarget: 1 });
    await timers.run();
    assert.equal(tracker.get('ml', 'tx3')?.state, 'not-found');
    await timers.run();
    assert.equal(tracker.get('ml', 'tx3')?.state, 'not-found');
  }

  // 4. BTC rides getBtcStatus.
  {
    const timers = manualTimers();
    const tracker = new TxTracker(scriptedProvider([], [{ state: 'pending' }, { state: 'confirmed' }]), { timers });
    tracker.track({ id: 'btc1', chain: 'btc' });
    await timers.run();
    await timers.run();
    assert.equal(tracker.get('btc', 'btc1')?.state, 'confirmed');
  }

  // 5. stopAll clears every pending timer.
  {
    const timers = manualTimers();
    const tracker = new TxTracker(scriptedProvider([{ state: 'pending' }]), { timers });
    tracker.track({ id: 'tx4', chain: 'ml' });
    tracker.track({ id: 'tx5', chain: 'ml' });
    assert.ok(timers.pending() >= 2);
    tracker.stopAll();
    const before = timers.pending();
    await timers.run();
    assert.equal(timers.pending(), before, 'no timers fired after stopAll');
  }

  console.log('txTracker.test: ok');
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
