// BTC keyring per decisions.md R2: pure TypeScript on @scure/bip32 and
// @scure/btc-signer. BIP84-style P2WPKH accounts from the same BIP39 seed
// that backs the Mintlayer accounts. Derivation path m/84'/<coin>'/0'
// (coin 0 mainnet, 1 testnet), receiving <account>/0/i, change <account>/1/i.
// Signing ships with M3 (BtcTxBuilder); M1 covers keys and addresses.
import { HDKey } from '@scure/bip32';
import { Address, TEST_NETWORK, NETWORK, p2wpkh } from '@scure/btc-signer';

import { mnemonicToSeed, mnemonicToSeedSync } from './bip39';

export type BtcNetwork = 'mainnet' | 'testnet';

export type BtcAccount = {
  /** Standard BIP32 xpub of the account (m/84'/coin'/0'). */
  xpub: string;
  network: BtcNetwork;
};

export type BtcBranch = 0 | 1;

/** Account index is fixed at 0 for v1 (single-account wallet). */
const ACCOUNT_INDEX = 0;

function accountHd(network: BtcNetwork, seed: Uint8Array): HDKey {
  const coinType = network === 'mainnet' ? 0 : 1;
  const account = HDKey.fromMasterSeed(seed).derive(`m/84'/${coinType}'/${ACCOUNT_INDEX}'`);
  if (!account.publicKey) throw new Error('btc account derivation failed');
  return account;
}

/**
 * Derive the BTC P2WPKH account 0 from a validated mnemonic. The xpub is
 * public and safe to persist; private keys are re-derived from the seed
 * inside KeySession closures when signing (M3).
 */
export async function deriveBtcAccount(
  words: string[],
  network: BtcNetwork,
  passphrase?: string,
): Promise<BtcAccount> {
  return deriveBtcAccountAtPath(words, defaultAccountPath(network), network, passphrase);
}

function defaultAccountPath(network: BtcNetwork): string {
  const coinType = network === 'mainnet' ? 0 : 1;
  return `m/84'/${coinType}'/${ACCOUNT_INDEX}'`;
}

/**
 * Derive a BTC account from an explicit account path (the discovery
 * custom-path scan). The path replaces the default m/84'/<coin>'/0'; the
 * receiving/change layout below it stays <branch>/<index>.
 */
export async function deriveBtcAccountAtPath(
  words: string[],
  path: string,
  network: BtcNetwork,
  passphrase?: string,
): Promise<BtcAccount> {
  const seed = await mnemonicToSeed(words, passphrase);
  const hd = HDKey.fromMasterSeed(seed).derive(path);
  if (!hd.publicKey) throw new Error('btc account derivation failed');
  return { xpub: hd.publicExtendedKey, network };
}

/** Address for a key index on the receiving (0) or change (1) branch. */
export async function btcAddressAt(
  account: BtcAccount,
  branch: BtcBranch,
  index: number,
): Promise<string> {
  const hd = HDKey.fromExtendedKey(account.xpub).derive(`m/${branch}/${index}`);
  if (!hd.publicKey) throw new Error('btc address derivation failed');
  const net = account.network === 'mainnet' ? NETWORK : TEST_NETWORK;
  return Address(net).encode(p2wpkh(hd.publicKey, net));
}

/** Consecutive receiving addresses (discovery, receive screen). */
export async function btcReceiveAddresses(
  account: BtcAccount,
  count: number,
  from = 0,
): Promise<string[]> {
  const out: string[] = [];
  for (let i = from; i < from + count; i++) out.push(await btcAddressAt(account, 0, i));
  return out;
}

/**
 * Extended private key at a path under the account (m/branch/index), for the
 * M3 signing path. Never leaves a KeySession closure in callers.
 */
export function btcPrivateKeyAt(
  words: string[],
  network: BtcNetwork,
  branch: BtcBranch,
  index: number,
  passphrase?: string,
): Uint8Array {
  const hd = accountHd(network, mnemonicToSeedSync(words, passphrase)).derive(`m/${branch}/${index}`);
  if (!hd.privateKey) throw new Error('btc key derivation failed');
  return hd.privateKey;
}
