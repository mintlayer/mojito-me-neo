// Per-chain address and amount validation for the send flow (spec M3
// deliverable 3 and the security note on decimal strings). Pure functions:
// no network, no state, fully Node-testable against published vectors.
//
// Address rules (project decision log F5 and src/keys/mlAccounts.ts): Mintlayer
// addresses are bech32m with the mtc (mainnet) or tmt (testnet) human
// readable part and the 0x01 pubkeyhash variant byte; BTC addresses on the
// v1 wallet are bech32 P2WPKH (bc1 / tb1, version 0, 20-byte program).
// Anything else is rejected with a typed error, never a regex guess: the
// checksums come from @scure/base, the same encoders the keyrings use.
import { bech32, bech32m } from '@scure/base';
import { decimalsToAtoms } from '../money';
import type { NetworkFlag } from '../config/endpoints';
import type { MlNetwork } from '../../modules/mojito-core';

export type AddressChain = 'ml' | 'btc';

export type AddressError =
  | { kind: 'malformed' }
  | { kind: 'wrongChain'; expected: AddressChain }
  | { kind: 'wrongNetwork'; expected: MlNetwork | 'btc-mainnet' | 'btc-testnet' };

const ML_HRP: Record<NetworkFlag, string> = { mainnet: 'mtc', testnet: 'tmt' };
const BTC_HRP: Record<NetworkFlag, string> = { mainnet: 'bc', testnet: 'tb' };

/** bech32 length ceiling for decode; wallet addresses sit far below it. */
const DECODE_LIMIT = 1023;

/** Destination variant byte for the Mintlayer pubkeyhash address (mlAccounts). */
const ML_PUBKEYHASH_VARIANT = 0x01;

/** P2WPKH bech32 words: witness version word 0 plus 20 bytes regrouped to 32. */
const BTC_P2WPKH_WORD_LENGTH = 33;

function mlShape(raw: string): { prefix: string } | null {
  try {
    const { prefix, words } = bech32m.decode(raw, DECODE_LIMIT);
    // Pubkeyhash payload: 0x01 variant byte plus a 20-byte BLAKE2b digest
    // (src/keys/mlAccounts.ts); words are 5-bit groups, so regroup first.
    const payload = bech32m.fromWords(words);
    if (payload.length !== 21 || payload[0] !== ML_PUBKEYHASH_VARIANT) return null;
    return { prefix };
  } catch {
    return null;
  }
}

function btcShape(raw: string): { prefix: string } | null {
  try {
    const { prefix, words } = bech32.decode(raw, DECODE_LIMIT);
    if (words.length !== BTC_P2WPKH_WORD_LENGTH || words[0] !== 0) return null;
    return { prefix };
  } catch {
    return null;
  }
}

/**
 * Validate one recipient address for the given chain and active network.
 * Returns null when the address is spendable as-is; the caller maps the
 * typed error to its i18n copy (send.to.error.*). Distinct wrong-chain and
 * wrong-network errors keep the "sent to the wrong place" class visible
 * instead of collapsing it into a generic malformed message.
 */
export function validateAddress(raw: string, chain: AddressChain, network: NetworkFlag): AddressError | null {
  const text = raw.trim();
  if (text.length === 0 || text !== text.toLowerCase() && text !== text.toUpperCase()) {
    return { kind: 'malformed' };
  }
  if (chain === 'ml') {
    const ml = mlShape(text);
    if (ml !== null) {
      // The named network is the one the pasted address belongs to, so the
      // copy can say what the address actually is (a mainnet address in a
      // testnet wallet must read as mainnet, not as the wallet's network).
      if (ml.prefix !== ML_HRP[network]) {
        const expected: MlNetwork = ml.prefix === ML_HRP.mainnet ? 'mainnet' : 'testnet';
        return { kind: 'wrongNetwork', expected };
      }
      return null;
    }
    if (btcShape(text) !== null) return { kind: 'wrongChain', expected: 'btc' };
    return { kind: 'malformed' };
  }
  const btc = btcShape(text);
  if (btc !== null) {
    if (btc.prefix !== BTC_HRP[network]) {
      // Only the two documented BTC prefixes name a network in the copy; a
      // non-standard P2WPKH-shaped HRP (bcrt regtest and the like) falls
      // through to the generic malformed message instead of a wrong-network
      // claim this wallet cannot mean.
      const expected = btc.prefix === BTC_HRP.mainnet ? 'btc-mainnet' : btc.prefix === BTC_HRP.testnet ? 'btc-testnet' : null;
      if (expected === null) return { kind: 'malformed' };
      return { kind: 'wrongNetwork', expected };
    }
    return null;
  }
  if (mlShape(text) !== null) return { kind: 'wrongChain', expected: 'ml' };
  return { kind: 'malformed' };
}

export type AmountInputError = 'parse' | 'tooManyDecimals';

export type AmountParseResult =
  | { ok: true; atoms: string }
  | { ok: false; error: AmountInputError };

/**
 * Parse one send amount exactly (spec M3 security note): digits and at most
 * one decimal point, no sign, no separators, no exponent; fraction digits
 * beyond the token's decimals are rejected instead of silently rounded
 * (decimalsToAtoms rounds, which would move funds the user did not type).
 * All arithmetic happens on digit strings, never floats.
 */
export function parseSendAmount(raw: string, decimals: number): AmountParseResult {
  const text = raw.trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return { ok: false, error: 'parse' };
  const dot = text.indexOf('.');
  if (dot !== -1 && text.length - dot - 1 > decimals) return { ok: false, error: 'tooManyDecimals' };
  const atoms = decimalsToAtoms(text, decimals);
  if (!/^\d+$/.test(atoms) || atoms === '0') return { ok: false, error: 'parse' };
  return { ok: true, atoms };
}

/** True when the typed atoms exceed the spendable balance atoms (BigInt). */
export function exceedsBalance(atoms: string, balanceAtoms: string): boolean {
  try {
    return BigInt(atoms) > BigInt(balanceAtoms);
  } catch {
    return true;
  }
}
