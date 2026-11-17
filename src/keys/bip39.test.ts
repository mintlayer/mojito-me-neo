// BIP39 gate tests: the public test vector mnemonic, checksum rejection,
// normalization, wordlist integrity and PBKDF2 seeding. Run via
//   tsx src/keys/bip39.test.ts
import { strict as assert } from 'node:assert/strict';

import {
  Bip39Error,
  generateMnemonic,
  mnemonicToSeed,
  mixEntropy,
  normalizeWords,
  validateMnemonic,
  wordlistChecksum,
} from './bip39';
import { BIP39_WORDLIST_SHA256 } from './bip39Words';

const VECTOR_24 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

// Public 12-word BIP39 test vector (same entropy family as the 24-word one).
const VECTOR_12 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

async function main() {
  // Wordlist integrity: a corrupted or truncated bundled list fails here.
  assert.equal(wordlistChecksum(), BIP39_WORDLIST_SHA256);
  const { BIP39_WORDS } = await import('./bip39Words');
  assert.equal(BIP39_WORDS.length, 2048);
  assert.equal(BIP39_WORDS[0], 'abandon');
  assert.equal(BIP39_WORDS[2047], 'zoo');

  // The milestone parity mnemonic validates; entropy and seed are stable.
  const words24 = VECTOR_24.split(' ');
  assert.equal(words24.length, 24);
  assert.equal(await validateMnemonic(words24), true);

  const words12 = VECTOR_12.split(' ');
  assert.equal(await validateMnemonic(words12), true);

  // Deterministic 12-word vector: seed is the well-known BIP39 test seed.
  const seed12 = await mnemonicToSeed(words12);
  assert.equal(
    bytesToHex(seed12),
    '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4',
    '12-word PBKDF2 seed must match the published BIP39 test vector',
  );

  // Deterministic 24-word vector seed (cross-checked with Python's
  // hashlib.pbkdf2_hmac on the same phrase).
  const seed24 = await mnemonicToSeed(words24);
  assert.equal(
    bytesToHex(seed24),
    '408b285c123836004f4b8842c89324c1f01382450c0d439af345ba7fc49acf705489c6fc77dbd4e3dc1dd8cc6bc9f043db8ada1e243c4a0eafb290d399480840',
    '24-word PBKDF2 seed must match the published BIP39 test vector',
  );

  // Passphrase changes the seed.
  const seedPass = await mnemonicToSeed(words12, 'TREZOR');
  assert.notEqual(bytesToHex(seedPass), bytesToHex(seed12));
  assert.equal(seedPass.length, 64);

  // Checksum rejection: mutating the last word keeps words valid but breaks
  // the checksum bit pattern.
  const broken = [...words24];
  broken[23] = 'about';
  await assert.rejects(
    () => validateMnemonic(broken),
    (e: unknown) => e instanceof Bip39Error && e.kind === 'checksum',
  );

  // Foreign word rejection.
  await assert.rejects(
    () => validateMnemonic([...words12.slice(0, 11), 'notaword']),
    (e: unknown) => e instanceof Bip39Error && e.kind === 'word',
  );

  // Length rejection.
  await assert.rejects(
    () => validateMnemonic(words12.slice(0, 6)),
    (e: unknown) => e instanceof Bip39Error && e.kind === 'length',
  );

  // NFKD normalization: uppercase, wide spacing and compatibility forms.
  assert.deepEqual(normalizeWords('  Abandon  ABANDON\tabandon\nabandon '), [
    'abandon',
    'abandon',
    'abandon',
    'abandon',
  ]);
  assert.deepEqual(normalizeWords('Ａｂａｎｄｏｎ'), ['abandon'], 'NFKD folds fullwidth latin');

  // Generation roundtrip: both strengths produce valid phrases.
  for (const strength of [128, 256] as const) {
    const generated = await generateMnemonic(strength);
    assert.equal(generated.length, strength / 32 * 3);
    assert.equal(await validateMnemonic(generated), true);
  }

  // Entropy mixing is deterministic in its shape and differs from the pool.
  const pool = new Uint8Array(32).fill(7);
  const mixedA = await mixEntropy(pool);
  const mixedB = await mixEntropy(pool);
  assert.equal(mixedA.length, 32);
  assert.notDeepEqual(mixedA, pool);
  assert.notDeepEqual(mixedA, mixedB, 'mixing pulls fresh random per call');

  console.log('bip39.test.ts: all assertions passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
