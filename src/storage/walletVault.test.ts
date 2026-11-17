// Storage-layer gate tests, Node-run with the memory fallbacks:
// vault roundtrip over seal and blob persistence, meta-only reads, wipe,
// the two-slot gating upgrade in both directions with the verified-readback
// ordering (old slot deleted only after the new blob verifies, injected
// seal and readback failures leave the old vault intact), and the PIN store
// set/verify/lockout-escalation flows.
//   tsx src/storage/walletVault.test.ts && tsx src/storage/pinStore.test.ts
import { strict as assert } from 'node:assert/strict';

import { getSecureStore } from './secureStore';
import { getBlobStore } from './blobStore';
import { walletVault, VaultUpgradeError } from './walletVault';
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

  await walletVault.save(WORDS, META, false);
  assert.equal(await walletVault.exists(), true);
  // The memory double never gates: keyGated reports the native gate state.
  assert.equal(await walletVault.keyGated(), false);

  const meta = await walletVault.meta();
  assert.deepEqual(meta, META);

  // The phrase roundtrips byte for byte through the sealed payload.
  const words = await walletVault.openWords();
  assert.deepEqual(words, WORDS);

  // The sealed blob at rest carries no plaintext phrase.
  const { store: blobs } = await getBlobStore();
  const blob = await blobs.get('seed.v1');
  assert.ok(blob, 'sealed blob must persist');
  const serialized = JSON.stringify(blob);
  assert.ok(!serialized.includes('abandon'), 'ciphertext must not contain the phrase');

  // Gating upgrade, enable direction: the legacy ungated seed.v1 slot
  // re-seals under the fixed seed.v2 target, and the old slot is deleted
  // only after the new blob reads back byte-equal.
  const gatedKey = await walletVault.upgradeGating(WORDS, META, true);
  assert.equal(gatedKey, 'seed.v2');
  assert.equal(await blobs.get('seed.v1'), null, 'old blob must be gone after the verified upgrade');
  assert.ok(await blobs.get('seed.v2'), 're-sealed blob must persist');
  assert.deepEqual(await walletVault.meta(), META);
  assert.deepEqual(await walletVault.openWords(), WORDS);
  assert.equal(await walletVault.exists(), true);
  assert.equal(await walletVault.keyGated(), false);

  // Gating upgrade, disable direction: the re-seal ping-pongs back to the
  // first slot, so toggling biometrics off un-gates at the next unlock.
  const ungatedKey = await walletVault.upgradeGating(WORDS, META, false);
  assert.equal(ungatedKey, 'seed.v1');
  assert.equal(await blobs.get('seed.v2'), null);
  assert.ok(await blobs.get('seed.v1'), 're-sealed blob must persist');
  assert.deepEqual(await walletVault.meta(), META);

  // Injected seal failure: the upgrade rejects with the retryable
  // VaultUpgradeError, the old vault stays fully intact and no new-slot
  // remnant survives.
  const { store } = await getSecureStore();
  const realSeal = store.seal.bind(store);
  store.seal = async () => {
    throw new Error('injected seal failure');
  };
  await assert.rejects(() => walletVault.upgradeGating(WORDS, META, true), VaultUpgradeError);
  assert.ok(await blobs.get('seed.v1'), 'old vault must survive a failed seal');
  assert.equal(await blobs.get('seed.v2'), null, 'no remnant blob after a failed seal');
  assert.deepEqual(await walletVault.meta(), META);
  store.seal = realSeal;

  // Injected readback failure: the verified-readback gate keeps the old
  // slot intact and the new-slot remnants are cleaned up before the throw.
  const realOpen = store.open.bind(store);
  store.open = async (keyId, sealed) => {
    if (keyId === 'seed.v2') throw new Error('injected readback failure');
    return realOpen(keyId, sealed);
  };
  await assert.rejects(() => walletVault.upgradeGating(WORDS, META, true), VaultUpgradeError);
  assert.ok(await blobs.get('seed.v1'), 'old vault must survive a failed readback');
  assert.equal(await blobs.get('seed.v2'), null, 'no remnant blob after a failed readback');
  assert.deepEqual(await walletVault.meta(), META);
  store.open = realOpen;

  await walletVault.wipe();
  assert.equal(await walletVault.exists(), false);
  assert.equal(await store.keyExists('seed.v1'), false);
  assert.equal(await store.keyExists('seed.v2'), false);
  assert.equal(await walletVault.meta(), null);
  assert.equal(await blobs.get('seed.v1'), null);
  assert.equal(await blobs.get('seed.v2'), null);

  console.log('walletVault.test.ts: seal, meta, open, two-slot gating upgrade, wipe all pass');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
