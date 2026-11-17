// Self-check for the memory SecureStore fallback: seal/open roundtrip, wrong
// key rejection, wipe. The native path is exercised on device builds.
//   npx tsx src/storage/secureStore.test.ts
import { strict as assert } from 'node:assert/strict';

import { createMemorySecureStore } from './secureStore';

async function main() {
  const store = createMemorySecureStore();

  const plaintext = new TextEncoder().encode('hello mojito');
  const blob = await store.seal('seed.v1', plaintext);

  assert.equal(blob.v, 1);
  assert.equal(blob.iv.length, 24); // 12 bytes hex
  assert.equal(blob.tag.length, 32); // 16 bytes hex
  assert.notEqual(blob.ct, '');

  const opened = await store.open('seed.v1', blob);
  assert.deepEqual(new TextDecoder().decode(opened), 'hello mojito');

  // A blob sealed under one keyId must not open under another.
  await assert.rejects(() => store.open('pin.meta.v1', blob), /open failed/);

  // Tampered ciphertext must reject.
  const tampered = { ...blob, ct: blob.ct.slice(0, -2) + (blob.ct.endsWith('00') ? '11' : '00') };
  await assert.rejects(() => store.open('seed.v1', tampered), /open failed/);

  assert.equal(await store.keyExists('seed.v1'), true);
  await store.wipe('seed.v1');
  assert.equal(await store.keyExists('seed.v1'), false);
  await assert.rejects(() => store.open('seed.v1', blob), /open failed/);

  // Empty payloads roundtrip too.
  const empty = await store.seal('pin.meta.v1', new Uint8Array(0));
  assert.deepEqual(await store.open('pin.meta.v1', empty), new Uint8Array(0));

  console.log('secureStore: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
