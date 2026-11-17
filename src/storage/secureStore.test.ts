// Self-check for the memory SecureStore fallback: seal/open roundtrip, wrong
// key rejection, wipe. The native path is exercised on device builds.
//   npx tsx src/storage/secureStore.test.ts
import { strict as assert } from 'node:assert/strict';

import { STORAGE_KEYS } from './keys';
import { createMemorySecureStore } from './secureStore';

async function main() {
  const store = createMemorySecureStore();

  const plaintext = new TextEncoder().encode('hello mojito');
  const seedKey = STORAGE_KEYS.seed;
  const blob = await store.seal(seedKey, plaintext, false);

  assert.equal(blob.v, 1);
  assert.equal(blob.iv.length, 24); // 12 bytes hex
  assert.equal(blob.tag.length, 32); // 16 bytes hex
  assert.notEqual(blob.ct, '');

  const opened = await store.open(seedKey, blob);
  assert.deepEqual(new TextDecoder().decode(opened), 'hello mojito');

  // A blob sealed under one keyId must not open under another.
  await assert.rejects(() => store.open(STORAGE_KEYS.pinMeta, blob), /open failed/);

  // Tampered ciphertext must reject.
  const tampered = { ...blob, ct: blob.ct.slice(0, -2) + (blob.ct.endsWith('00') ? '11' : '00') };
  await assert.rejects(() => store.open(seedKey, tampered), /open failed/);

  assert.equal(await store.keyExists(seedKey), true);
  // The memory double never gates.
  assert.equal(await store.keyGated(seedKey), false);
  await store.wipe(seedKey);
  assert.equal(await store.keyExists(seedKey), false);
  await assert.rejects(() => store.open(seedKey, blob), /open failed/);

  // Empty payloads roundtrip too.
  const empty = await store.seal(STORAGE_KEYS.pinMeta, new Uint8Array(0), false);
  assert.deepEqual(await store.open(STORAGE_KEYS.pinMeta, empty), new Uint8Array(0));

  console.log('secureStore: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
