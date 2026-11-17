// Full BIP39 (English): secure entropy, mnemonic generation, import
// validation and PBKDF2-HMAC-SHA512 seeding. The wordlist is bundled in
// bip39Words.ts; hashing comes from @noble/hashes (pure JS, Hermes-safe,
// Uint8Array only). Entropy comes from the native core's secureRandom; a
// WebCrypto fallback exists only in dev and test runtimes, mirroring the
// secureStore fallback policy: a release build without the native core
// fails loudly instead of generating keys from an unverified source.
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

import { BIP39_WORDS, BIP39_WORDLIST_SHA256 } from './bip39Words';

export type WordCount = 12 | 15 | 18 | 21 | 24;

export type MnemonicStrength = 128 | 256;

const WORDLIST: readonly string[] = BIP39_WORDS;

const WORD_INDEX = new Map<string, number>(WORDLIST.map((w, i) => [w, i]));

const SUPPORTED_COUNTS: readonly WordCount[] = [12, 15, 18, 21, 24];

const PBKDF2_ROUNDS = 2048;

const SEED_BYTES = 64;

declare const __DEV__: boolean | undefined;

/** Same gate as the secureStore memory fallback: Node tooling (no __DEV__)
 *  and dev builds may use WebCrypto; release builds must not. */
function webCryptoAllowed(): boolean {
  return typeof __DEV__ === 'undefined' || __DEV__ === true;
}

export class Bip39Error extends Error {
  readonly kind: 'length' | 'word' | 'checksum' | 'entropy';
  constructor(kind: Bip39Error['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

function isBip39Error(e: unknown): e is Bip39Error {
  return e instanceof Bip39Error;
}

/** Native-core secure random with the gated WebCrypto fallback. */
async function secureEntropy(bytes: number): Promise<Uint8Array> {
  try {
    const core = await import('../../modules/mojito-core');
    if (await core.hasNativeCore()) return await core.MojitoCore.secureRandom(bytes);
  } catch {
    // fall through to WebCrypto where allowed
  }
  const webCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (webCrypto?.getRandomValues && webCryptoAllowed()) {
    return webCrypto.getRandomValues(new Uint8Array(bytes));
  }
  throw new Bip39Error('entropy', 'no secure random source available');
}

/** NFKD-normalized, lowercased, whitespace-split words. */
export function normalizeWords(raw: string): string[] {
  return raw
    .normalize('NFKD')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/** 11 bits per word over the 2048-entry list. */
function bitsToWords(bits: boolean[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + 11 <= bits.length; i += 11) {
    let index = 0;
    for (let j = 0; j < 11; j++) index = (index << 1) | (bits[i + j] ? 1 : 0);
    out.push(WORDLIST[index]);
  }
  return out;
}

function wordsToBits(words: string[]): boolean[] {
  const bits: boolean[] = [];
  for (const word of words) {
    const index = WORD_INDEX.get(word);
    if (index === undefined) throw new Bip39Error('word', `not in the BIP39 word list: ${word}`);
    for (let j = 10; j >= 0; j--) bits.push(((index >> j) & 1) === 1);
  }
  return bits;
}

function entropyToMnemonic(entropy: Uint8Array): string[] {
  const hash = sha256(entropy);
  const bits: boolean[] = [];
  for (const byte of entropy) for (let j = 7; j >= 0; j--) bits.push(((byte >> j) & 1) === 1);
  const checksumBits = (entropy.length * 8) / 32;
  for (let i = 0; i < checksumBits; i++) bits.push(((hash[0] >> (7 - i)) & 1) === 1);
  return bitsToWords(bits);
}

/**
 * Generate a mnemonic from secure entropy. 128 bits yield 12 words, 256 bits
 * 24 words; the onboarding default is 24 words.
 */
export async function generateMnemonic(strength: MnemonicStrength = 256): Promise<string[]> {
  if (strength !== 128 && strength !== 256) {
    throw new Bip39Error('entropy', 'strength must be 128 or 256 bits');
  }
  const entropy = await secureEntropy(strength / 8);
  return entropyToMnemonic(entropy);
}

/** Mix externally collected entropy (for example the drawn-entropy pool)
 *  with fresh secure random before use: the drawing alone never carries
 *  enough min-entropy to seed a wallet. */
export async function mixEntropy(pool: Uint8Array): Promise<Uint8Array> {
  if (pool.length === 0) throw new Bip39Error('entropy', 'entropy pool is empty');
  const random = await secureEntropy(32);
  const drawn = sha256(pool);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = drawn[i] ^ random[i];
  return out;
}

/** Full validation: word count, list membership and checksum. Rejects with a
 *  Bip39Error carrying the failure kind; resolves true exactly when the
 *  phrase is a well-formed BIP39 mnemonic. */
export async function validateMnemonic(words: string[]): Promise<boolean> {
  if (!SUPPORTED_COUNTS.includes(words.length as WordCount)) {
    throw new Bip39Error('length', `unsupported word count: ${words.length}`);
  }
  const bits = wordsToBits(words); // throws Bip39Error('word') on foreign words
  const totalBits = words.length * 11;
  const checksumBits = totalBits / 33;
  const entropyBits = bits.slice(0, totalBits - checksumBits);
  const given = bits.slice(totalBits - checksumBits);
  const entropy = new Uint8Array(entropyBits.length / 8);
  entropyBits.forEach((bit, i) => {
    if (bit) entropy[i >> 3] |= 1 << (7 - (i & 7));
  });
  const hash = sha256(entropy);
  for (let i = 0; i < checksumBits; i++) {
    const expected = ((hash[0] >> (7 - i)) & 1) === 1;
    if (given[i] !== expected) throw new Bip39Error('checksum', 'BIP39 checksum mismatch');
  }
  return true;
}

/** PBKDF2-HMAC-SHA512 over the NFKD-normalized phrase, 2048 rounds, salt
 *  'mnemonic' plus the optional passphrase. Returns the 64-byte BIP32 seed. */
export async function mnemonicToSeed(words: string[], passphrase?: string): Promise<Uint8Array> {
  await validateMnemonic(words);
  const phrase = words.join(' ').normalize('NFKD');
  const salt = `mnemonic${passphrase ?? ''}`;
  return pbkdf2(sha512, utf8ToBytes(phrase), utf8ToBytes(salt), {
    c: PBKDF2_ROUNDS,
    dkLen: SEED_BYTES,
  });
}

/** 256-bit checksum over the bundled wordlist; asserted in bip39.test.ts so
 *  a corrupted or truncated list fails the build. */
export function wordlistChecksum(): string {
  let hex = '';
  for (const byte of sha256(utf8ToBytes(WORDLIST.join(' ')))) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

export { isBip39Error, SUPPORTED_COUNTS };
