// PIN store gate: set, verify, per-failure bookkeeping and lockout
// escalation with persisted state (Node-run on the memory fallbacks).
//   tsx src/storage/pinStore.test.ts
import { strict as assert } from 'node:assert/strict';

import { LOCK_ATTEMPTS, LOCK_SECONDS, pinStore } from './pinStore';

async function main() {
  assert.equal(await pinStore.exists(), false);
  assert.equal(await pinStore.verify('123456'), 'wrong', 'no PIN configured yet');

  await pinStore.setPin('123456');
  assert.equal(await pinStore.exists(), true);
  assert.equal(await pinStore.verify('123456'), 'ok');
  assert.equal(await pinStore.verify('654321'), 'wrong');

  // A wrong PIN counts; the counter survives "restarts" through the store.
  for (let i = 0; i < LOCK_ATTEMPTS - 1; i++) await pinStore.registerFailure();
  assert.equal(await pinStore.verify('123456'), 'ok', 'not locked below the threshold');
  assert.equal(await pinStore.lockSecondsLeft(), 0);

  // The burst that reaches the threshold arms LOCK_SECONDS.
  await pinStore.registerFailure();
  assert.equal(await pinStore.verify('123456'), 'locked');
  assert.ok(
    (await pinStore.lockSecondsLeft()) > 0 && (await pinStore.lockSecondsLeft()) <= LOCK_SECONDS,
  );

  // The next full burst doubles the lock.
  for (let i = 0; i < LOCK_ATTEMPTS; i++) await pinStore.registerFailure();
  const doubled = await pinStore.lockSecondsLeft();
  assert.ok(doubled > LOCK_SECONDS && doubled <= LOCK_SECONDS * 2, `lock escalated to ${doubled}s`);

  // A successful verify resets attempts and the lock.
  await pinStore.resetAttempts();
  assert.equal(await pinStore.lockSecondsLeft(), 0);
  assert.equal(await pinStore.verify('123456'), 'ok');

  // Replacing the PIN invalidates the old verifier.
  await pinStore.setPin('987654');
  assert.equal(await pinStore.verify('123456'), 'wrong');
  assert.equal(await pinStore.verify('987654'), 'ok');

  // Wipe (settings sign-out): verifier and key are gone.
  await pinStore.wipe();
  assert.equal(await pinStore.exists(), false);
  assert.equal(await pinStore.verify('987654'), 'wrong');

  console.log('pinStore.test.ts: set, verify, lockout escalation, wipe all pass');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
