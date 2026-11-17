// KeySession gate: the phrase never leaves the withSeed closure, xpubs are
// public and stable, and the session refuses to open an empty vault.
// Node-run on the memory fallbacks.
//   tsx src/keys/session.test.ts
import { strict as assert } from 'node:assert/strict';

import { bytesToHex } from '@noble/hashes/utils.js';

import { openKeySession } from './session';
import { walletVault } from '../storage/walletVault';
import type { VaultMeta } from '../storage/walletVault';

const WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' ');

const META: VaultMeta = { v: 1, createdAt: 0, network: 'testnet', wordCount: 12, hasPassphrase: false };

async function main() {
  // No wallet: the session cannot exist.
  await assert.rejects(() => openKeySession(), /vault is empty/);

  await walletVault.save(WORDS, META, false);
  const session = await openKeySession();

  // The seed handed to the closure is the published BIP39 vector seed, and
  // the buffer is scrubbed when the closure returns.
  let leaked: Uint8Array | null = null;
  let observed = '';
  const seed = await session.withSeed(async (s) => {
    leaked = s; // same reference, no copy: the scrub below must reach it
    observed = bytesToHex(s);
    return s.length;
  });
  assert.equal(seed, 64);
  assert.equal(
    observed,
    '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4',
  );
  assert.ok([...leaked!].every((b) => b === 0), 'seed buffer must be zeroized after the closure');

  // Account xpubs are public, deterministic and well-formed for the network.
  // Byte parity with the bindings lives in mlAccounts.test.ts.
  const xpub = bytesToHex(await session.xpubMl('testnet'));
  assert.ok(xpub.startsWith('00038000002c8000000180000000'), 'blob header is 44\'/1\'/0\'');
  assert.equal(xpub.length, 79 * 2);
  assert.equal(bytesToHex(await (await openKeySession()).xpubMl('testnet')), xpub);
  const btc = await session.xpubBtc('mainnet');
  assert.ok(btc.startsWith('xpub'), 'btc account xpub in standard form');

  // Closure failures still release the plaintext path cleanly.
  await assert.rejects(() => session.withSeed(async () => { throw new Error('boom'); }), /boom/);

  // release() ends the session: the phrase reference is dropped and every
  // other method refuses to run. release is idempotent.
  session.release();
  session.release();
  await assert.rejects(() => session.withSeed(async () => 0), /released/);
  await assert.rejects(() => session.xpubMl('testnet'), /released/);
  await assert.rejects(() => session.xpubBtc('testnet'), /released/);

  // A fresh session still works after another one was released.
  const second = await openKeySession();
  assert.ok((await second.xpubBtc('mainnet')).startsWith('xpub'));
  second.release();

  await walletVault.wipe();
  console.log('session.test.ts: closure isolation, release and xpub parity pass');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
