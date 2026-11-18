// Local waitlist store: seal at rest, one slot per install, idempotent
// rejoin, wipe on leave, counter increment:
//   npx tsx src/data/mock/localWaitlist.test.ts
import { strict as assert } from 'node:assert/strict';

import { createLocalWaitlistProvider, localWaitlistCounter } from './localWaitlist';
import { WAITLIST } from '../../data';
import { getBlobStore } from '../../storage/blobStore';
import { STORAGE_KEYS } from '../../storage/keys';
import { getSecureStore } from '../../storage/secureStore';

const KEY = STORAGE_KEYS.waitlistEmail;

async function main() {
  const provider = createLocalWaitlistProvider();

  // Fresh install: nothing joined, the counter sits at the fixture seed.
  assert.deepEqual(await provider.status(), { joined: false, email: null, position: null });
  assert.deepEqual(await localWaitlistCounter(), { taken: WAITLIST.taken, total: WAITLIST.total });

  // A fresh join persists and reports a position.
  const joined = await provider.join('Waitlist.Test@Example.COM');
  assert.ok(joined.ok);
  assert.ok(joined.ok && joined.position === WAITLIST.taken + 1, 'the local position is the seed plus one');

  // Seal at rest: the blob exists under the waitlist key id and its
  // ciphertext carries no plaintext email bytes.
  const { store } = await getSecureStore();
  const { store: blobs } = await getBlobStore();
  const blob = await blobs.get(KEY);
  assert.ok(blob, 'the entry persists as a sealed blob');
  assert.ok(await store.keyExists(KEY));
  const plaintextHex = Buffer.from('waitlist.test@example.com', 'utf8').toString('hex');
  assert.ok(!blob.ct.includes(plaintextHex), 'the sealed ciphertext never carries the plaintext address');
  const reopened = JSON.parse(new TextDecoder().decode(await store.open(KEY, blob))) as { email: string; joinedAt: string; position: number };
  assert.equal(reopened.email, 'waitlist.test@example.com', 'the stored address is the normalized form');
  assert.ok(!Number.isNaN(Date.parse(reopened.joinedAt)), 'joinedAt is an ISO timestamp');
  assert.equal(reopened.position, WAITLIST.taken + 1);

  // The counter reflects the local join.
  assert.deepEqual(await localWaitlistCounter(), { taken: WAITLIST.taken + 1, total: WAITLIST.total });

  // Idempotent rejoin: the same address (any spelling that normalizes to
  // it) succeeds again without a new position.
  const rejoin = await provider.join('waitlist.test@example.com ');
  assert.deepEqual(rejoin, { ok: true, position: null });
  assert.equal((await provider.status()).position, WAITLIST.taken + 1);

  // One slot per install: a different address is refused as duplicate and
  // the stored address survives for the masked duplicate callout.
  const duplicate = await provider.join('someone.else@example.com');
  assert.deepEqual(duplicate, { ok: false, reason: 'duplicate' });
  const status = await provider.status();
  assert.equal(status.joined, true);
  assert.equal(status.email, 'waitlist.test@example.com');

  // Validation stays provider-side: malformed input never touches the slot.
  const invalid = await provider.join('not-an-email');
  assert.deepEqual(invalid, { ok: false, reason: 'invalid' });
  assert.equal((await provider.status()).email, 'waitlist.test@example.com');

  // A new provider instance sees the same persisted slot (restart
  // semantics in-process; the device restart case is the manual matrix).
  const second = createLocalWaitlistProvider();
  assert.equal((await second.status()).joined, true);

  // Leave wipes the key id and the blob; rejoin works afterwards.
  await second.leave();
  assert.equal(await blobs.get(KEY), null);
  assert.equal(await store.keyExists(KEY), false);
  assert.deepEqual(await second.status(), { joined: false, email: null, position: null });
  assert.deepEqual(await localWaitlistCounter(), { taken: WAITLIST.taken, total: WAITLIST.total });
  const rejoinAfterLeave = await second.join('waitlist.test@example.com');
  assert.ok(rejoinAfterLeave.ok);
  await second.leave();
  assert.deepEqual(await second.status(), { joined: false, email: null, position: null });

  console.log('local waitlist: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
