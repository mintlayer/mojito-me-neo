// Storage-layer gate tests, Node-run with the memory fallbacks:
// vault roundtrip over seal and blob persistence, meta-only reads, wipe,
// and the PIN store set/verify/lockout-escalation flows.
//   tsx src/storage/walletVault.test.ts && tsx src/storage/pinStore.test.ts
import { strict as assert } from 'node:assert/strict';

import { walletVault } from './walletVault';
import type { VaultMeta } from './walletVault';

const WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' ');

const META: VaultMeta = {
  v: 1,
  createdAt: 1700000000000,
  network: 'testnet',
  wordCount: 12,
  hasPassphrase: false,
};

async function main() {
  assert.equal(await walletVault.exists(), false);
  assert.equal(await walletVault.meta(), null);
  await assert.rejects(() => walletVault.openWords(), /vault is empty/);

  await walletVault.save(WORDS, META);
  assert.equal(await walletVault.exists(), true);

  const meta = await walletVault.meta();
  assert.deepEqual(meta, META);

  // The phrase roundtrips byte for byte through the sealed payload.
  const words = await walletVault.openWords();
  assert.deepEqual(words, WORDS);

  // The sealed blob at rest carries no plaintext phrase.
  const { store: blobs } = await import('./blobStore').then((m) => m.getBlobStore());
  const blob = await blobs.get('seed.v1');
  assert.ok(blob, 'sealed blob must persist');
  const serialized = JSON.stringify(blob);
  assert.ok(!serialized.includes('abandon'), 'ciphertext must not contain the phrase');

  await walletVault.wipe();
  assert.equal(await walletVault.exists(), false);
  assert.equal(await walletVault.meta(), null);
  assert.equal(await blobs.get('seed.v1'), null);

  console.log('walletVault.test.ts: seal, meta, open, wipe all pass');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
