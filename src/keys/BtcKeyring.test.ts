// BTC keyring gate: the scure-based P2WPKH path must reproduce the published
// BIP84 test vectors. Node-run, pure TS (decisions R2).
//   tsx src/keys/BtcKeyring.test.ts
import { strict as assert } from 'node:assert/strict';

import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';

import { btcAddressAt, btcPrivateKeyAt, deriveBtcAccount } from './BtcKeyring';

const VECTOR_12 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' ');

// Published BIP84 first account public key (zpub, SLIP-132 P2WPKH version),
// from bip-0084.mediawiki vector 1.
const BIP84_ACCOUNT_ZPUB =
  'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';

// Published BIP84 addresses on the first account (bip-0084.mediawiki vector 1).
const BIP84_RECEIVING_0 = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const BIP84_RECEIVING_1 = 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g';
const BIP84_CHANGE_0 = 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el';

async function main() {
  const account = await deriveBtcAccount(VECTOR_12, 'mainnet');

  // The account extended public key must equal the published BIP84 zpub
  // once the SLIP-132 P2WPKH version bytes replace the standard xpub ones.
  const hd = (await import('@scure/bip32')).HDKey.fromExtendedKey(account.xpub);
  assert.ok(hd.publicKey, 'account public key must derive');
  const std = base58check(sha256).decode(account.xpub);
  const zpub = base58check(sha256).encode(
    new Uint8Array([0x04, 0xb2, 0x47, 0x46, ...std.slice(4)]),
  );
  assert.equal(zpub, BIP84_ACCOUNT_ZPUB, 'account xpub must match the published BIP84 zpub');

  // First receiving and change addresses of the published vector.
  assert.equal(await btcAddressAt(account, 0, 0), BIP84_RECEIVING_0, 'm/84/0/0/0/0 address');
  assert.equal(await btcAddressAt(account, 0, 1), BIP84_RECEIVING_1, 'm/84/0/0/0/1 address');
  assert.equal(await btcAddressAt(account, 1, 0), BIP84_CHANGE_0, 'm/84/0/0/1/0 address');

  // Determinism: same phrase, same account, same addresses.
  const again = await deriveBtcAccount(VECTOR_12, 'mainnet');
  assert.equal(await btcAddressAt(again, 0, 0), BIP84_RECEIVING_0);

  // Testnet is a separate derivation tree with its own hrp.
  const testnet = await deriveBtcAccount(VECTOR_12, 'testnet');
  const tnAddr = await btcAddressAt(testnet, 0, 0);
  assert.ok(tnAddr.startsWith('tb1q'), 'testnet P2WPKH addresses start tb1q');
  assert.notEqual(tnAddr, BIP84_RECEIVING_0);

  // The private key path derives the same key material the xpub path points
  // at: signing in M3 uses it, so its public point must match the account.
  const priv = btcPrivateKeyAt(VECTOR_12, 'mainnet', 0, 0);
  assert.equal(priv.length, 32);
  const { secp256k1 } = await import('@noble/curves/secp256k1.js');
  const point = secp256k1.getPublicKey(priv, true);
  const fromXpub = (await import('@scure/bip32')).HDKey.fromExtendedKey(account.xpub).derive('m/0/0');
  assert.deepEqual(point, fromXpub.publicKey, 'private and public paths must agree');

  console.log('BtcKeyring.test.ts: BIP84 vectors match');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
