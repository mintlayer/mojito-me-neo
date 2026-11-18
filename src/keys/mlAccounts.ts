// Mintlayer account derivation and address encoding in TypeScript.
//
// The native bindings (modules/mojito-core facade over the vendored
// wallet-bindings v0.1.0) remain the production path for transaction
// assembly. Key derivation for M1 runs here, in pure TypeScript over
// @scure/bip32 and @noble/hashes, because it must be verifiable in the Node
// gate and before a native build exists. Byte parity with the bindings is
// pinned by the upstream release vectors in mlAccounts.test.ts:
// the runtime blobs, the receiving public key blob and the bech32m addresses
// for the public test mnemonic on both networks.
//
// Formats come from mintlayer-core:
// - account path m/44'/<coin type>/0' (coin 19788 mainnet, 1 testnet)
// - receiving <account>/0/i, change <account>/1/i (normal derivation)
// - runtime key blobs: holder byte 0x00, level count, big-endian path levels
//   (hardened bit 0x80000000 set), chain code, key material
// - pubkeyhash addresses: bech32m over variant byte 0x01 plus the first 20
//   bytes of the 64-byte BLAKE2b digest of the holder blob (0x00 || point)
import { HDKey } from '@scure/bip32';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { bech32m } from '@scure/base';

import { mnemonicToSeed } from './bip39';
import type { MlNetwork } from '../../modules/mojito-core';

export type MlDerivationNetwork = Extract<MlNetwork, 'mainnet' | 'testnet'>;

export type MlCoinType = 19788 | 1;

export type MlAccount = {
  accountPrivkey: Uint8Array; // runtime blob, short-lived
  xpub: Uint8Array; // runtime blob, persisted-safe (public)
  network: MlDerivationNetwork;
  coinType: MlCoinType;
};

export type MlBranch = 0 | 1;

const HARDENED = 0x80000000;

const BIP44_PURPOSE = 44;

const COIN_TYPES: Record<MlDerivationNetwork, MlCoinType> = { mainnet: 19788, testnet: 1 };

const HRP: Record<MlDerivationNetwork, string> = { mainnet: 'mtc', testnet: 'tmt' };

// Destination variant byte for SCALE-encoded Destination::PublicKeyHash.
const DESTINATION_PUBLIC_KEY_HASH = 0x01;

// Runtime blob holder byte: 0x00 prefixes both blob shapes (mintlayer
// runtime format, pinned by the parity vectors): the extended-key blob reads
// kind, level count, path levels, chain code, key material - and the plain
// public-key blob is just the holder byte plus the compressed point. One
// byte, two shapes, hence the neutral name.
const BLOB_HOLDER_BYTE = 0x00;

/** Account index is fixed at 0 for v1 (single-account wallet). */
const ACCOUNT_INDEX = 0;

function u32be(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Extended-key runtime blob: kind, level count, path levels, chain code,
 *  key material (32-byte private or 33-byte compressed public). */
function extendedBlob(levels: Uint8Array[], chainCode: Uint8Array, key: Uint8Array): Uint8Array {
  return concatBytes(
    new Uint8Array([BLOB_HOLDER_BYTE, levels.length]),
    ...levels,
    chainCode,
    key,
  );
}

/** Plain public-key runtime blob: holder byte plus the compressed point. */
function publicKeyBlob(point: Uint8Array): Uint8Array {
  return concatBytes(new Uint8Array([BLOB_HOLDER_BYTE]), point);
}

function parseXpubBlob(xpub: Uint8Array): {
  levels: Uint8Array[];
  chainCode: Uint8Array;
  point: Uint8Array;
} {
  // kind(1) count(1) levels(4n) chainCode(32) point(33)
  const count = xpub[1];
  const levelsEnd = 2 + count * 4;
  const chainCode = xpub.slice(levelsEnd, levelsEnd + 32);
  const point = xpub.slice(levelsEnd + 32, levelsEnd + 32 + 33);
  if (point.length !== 33 || chainCode.length !== 32) {
    throw new Error('malformed extended public key blob');
  }
  const levels: Uint8Array[] = [];
  for (let i = 0; i < count; i++) levels.push(xpub.slice(2 + i * 4, 6 + i * 4));
  return { levels, chainCode, point };
}

/**
 * Watch-only child derivation over an account xpub blob, standard BIP32
 * public CKD (HMAC-SHA512 keyed by the chain code, child point = parent
 * point + IL*G). Equivalent to the bindings' makeReceivingAddressPublicKey /
 * makeChangeAddressPublicKey; pinned by the parity vectors.
 */
async function deriveChildPoint(xpub: Uint8Array, children: number[]): Promise<Uint8Array> {
  let { point, chainCode } = parseXpubBlob(xpub);
  for (const child of children) {
    if (!Number.isInteger(child) || child < 0 || child >= HARDENED) {
      throw new Error('child index must be a normal (non-hardened) index');
    }
    const digest = hmac(sha512, chainCode, concatBytes(point, u32be(child)));
    const tweak = digest.slice(0, 32);
    chainCode = digest.slice(32);
    // BIP32 pathological cases (IL >= n or the child point at infinity,
    // ~2^-128 per draw) are not rejected: noble reduces IL mod n, so the
    // tweak stays in range, and the next index is simply tried. Documented
    // ceiling, not an oversight.
    const childPoint = secp256k1.Point.fromHex(bytesToHex(point))
      .add(secp256k1.Point.BASE.multiply(BigInt('0x' + bytesToHex(tweak))))
      .toBytes(true);
    point = childPoint;
  }
  return point;
}

/**
 * Derive the default Mintlayer account from a validated mnemonic.
 * Passphrase must be remembered together with the phrase; it changes the
 * derived seed entirely.
 */
export async function deriveMlAccount(
  words: string[],
  network: MlDerivationNetwork,
  passphrase?: string,
): Promise<MlAccount> {
  const coinType = COIN_TYPES[network];
  return deriveMlAccountAtLevels(words, [BIP44_PURPOSE, coinType, ACCOUNT_INDEX], network, passphrase);
}

/**
 * Derive a Mintlayer account from an explicit account path (the discovery
 * custom-path scan). `levels` are plain indices, one per hardened level; the
 * runtime blob keeps the parsed path as entered instead of the default
 * m/44'/<coin type>/0'.
 */
export async function deriveMlAccountAtPath(
  words: string[],
  levels: number[],
  network: MlDerivationNetwork,
): Promise<MlAccount> {
  return deriveMlAccountAtLevels(words, levels, network);
}

async function deriveMlAccountAtLevels(
  words: string[],
  levels: number[],
  network: MlDerivationNetwork,
  passphrase?: string,
): Promise<MlAccount> {
  const seed = await mnemonicToSeed(words, passphrase);
  const path = `m/${levels.map((l) => `${l}'`).join('/')}`;
  const account = HDKey.fromMasterSeed(seed).derive(path);
  if (!account.privateKey || !account.chainCode || !account.publicKey) {
    throw new Error('account derivation failed');
  }
  const blobLevels = levels.map((l) => u32be(l | HARDENED));
  return {
    accountPrivkey: extendedBlob(blobLevels, account.chainCode, account.privateKey),
    xpub: extendedBlob(blobLevels, account.chainCode, account.publicKey),
    network,
    coinType: COIN_TYPES[network],
  };
}

/** The receiving or change public key blob at an index (watch-only). */
export async function mlAddressPublicKey(
  xpub: Uint8Array,
  branch: MlBranch,
  index: number,
): Promise<Uint8Array> {
  const point = await deriveChildPoint(xpub, [branch, index]);
  return publicKeyBlob(point);
}

/** The bech32m pubkeyhash address of a public key blob. */
export function mlPubkeyhashAddress(pubkeyBlob: Uint8Array, network: MlDerivationNetwork): string {
  const digest = blake2b(pubkeyBlob, { dkLen: 64 });
  const payload = concatBytes(new Uint8Array([DESTINATION_PUBLIC_KEY_HASH]), digest.slice(0, 20));
  return bech32m.encode(HRP[network], bech32m.toWords(payload));
}

/** Address at a receiving (0) or change (1) index, derived from the xpub blob. */
export async function mlAddressAt(
  xpub: Uint8Array,
  branch: MlBranch,
  index: number,
  network: MlDerivationNetwork,
): Promise<string> {
  const blob = await mlAddressPublicKey(xpub, branch, index);
  return mlPubkeyhashAddress(blob, network);
}

/** Consecutive receiving addresses for discovery and receive screens. */
export async function mlReceiveAddresses(
  xpub: Uint8Array,
  network: MlDerivationNetwork,
  count: number,
  from = 0,
): Promise<string[]> {
  const out: string[] = [];
  for (let i = from; i < from + count; i++) {
    out.push(await mlAddressAt(xpub, 0, i, network));
  }
  return out;
}

/**
 * Watch-only account straight from the 64-byte BIP39 seed (the KeySession
 * closure shape, M3 signing path): returns the public xpub blob only. Same
 * derivation as deriveMlAccount; the private form of this helper below is
 * the only place child keys leave a seed, always inside the closure.
 */
export function mlXpubFromSeed(
  seed: Uint8Array,
  network: MlDerivationNetwork,
): { xpub: Uint8Array; coinType: MlCoinType } {
  const coinType = COIN_TYPES[network];
  const account = HDKey.fromMasterSeed(seed).derive(defaultAccountPath(coinType));
  if (!account.chainCode || !account.publicKey) throw new Error('account derivation failed');
  const blobLevels = [BIP44_PURPOSE, coinType, ACCOUNT_INDEX].map((level) => u32be(level | HARDENED));
  return { xpub: extendedBlob(blobLevels, account.chainCode, account.publicKey), coinType };
}

/**
 * Child private key at a receiving (0) or change (1) index, from the seed.
 * Caller contract (src/keys/session.ts): seed bytes and the returned key
 * never leave the withSeed closure; the key feeds bindings.encodeWitness,
 * it is never logged, cached or returned.
 */
export function mlPrivateKeyFromSeed(
  seed: Uint8Array,
  network: MlDerivationNetwork,
  branch: MlBranch,
  index: number,
): Uint8Array {
  const coinType = COIN_TYPES[network];
  const child = HDKey.fromMasterSeed(seed).derive(`${defaultAccountPath(coinType)}/${branch}/${index}`);
  if (!child.privateKey) throw new Error('child key derivation failed');
  return child.privateKey;
}

function defaultAccountPath(coinType: MlCoinType): string {
  return `m/${BIP44_PURPOSE}'/${coinType}'/${ACCOUNT_INDEX}'`;
}
