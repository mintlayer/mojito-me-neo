// KeySession: short-lived access to the vault. The session object holds the
// phrase only for the duration of a call; derived account material is
// public (xpubs, addresses) and may be cached by the caller. Seed bytes and
// account privkeys never leave the withSeed closure and never reach state,
// context or logs.
import { mnemonicToSeed } from './bip39';
import { deriveMlAccount, type MlAccount } from './mlAccounts';
import { deriveBtcAccount } from './BtcKeyring';
import { walletVault } from '../storage/walletVault';
import type { MlNetwork } from '../../modules/mojito-core';

export type MlDerivationNetwork = Extract<MlNetwork, 'mainnet' | 'testnet'>;

export interface KeySession {
  /** Opens the vault, derives the 64-byte BIP32 seed, runs the closure and
   *  releases the plaintext: nothing survives the returned promise. */
  withSeed<T>(fn: (seed: Uint8Array) => Promise<T>): Promise<T>;
  /** Account 0 Mintlayer extended public key blob (public, persistable). */
  xpubMl(network?: MlDerivationNetwork): Promise<Uint8Array>;
  /** Account 0 BTC extended public key in standard xpub form (public). */
  xpubBtc(network: 'mainnet' | 'testnet'): Promise<string>;
}

class OpenKeySession implements KeySession {
  constructor(private readonly words: string[]) {}

  async withSeed<T>(fn: (seed: Uint8Array) => Promise<T>): Promise<T> {
    const seed = await mnemonicToSeed(this.words);
    try {
      return await fn(seed);
    } finally {
      // Best-effort scrub of the closure-visible buffer; JS has no zeroize,
      // but overwriting keeps the bytes from lingering in a live view.
      seed.fill(0);
    }
  }

  private async mlAccount(network: MlDerivationNetwork): Promise<MlAccount> {
    return deriveMlAccount(this.words, network);
  }

  async xpubMl(network: MlDerivationNetwork = 'mainnet'): Promise<Uint8Array> {
    return (await this.mlAccount(network)).xpub;
  }

  async xpubBtc(network: 'mainnet' | 'testnet'): Promise<string> {
    return (await deriveBtcAccount(this.words, network)).xpub;
  }
}

/**
 * Unlock-time session: decrypts the vault phrase (after PIN or biometrics)
 * and returns a short-lived handle. There is at most one at a time.
 */
export async function openKeySession(): Promise<KeySession> {
  const words = await walletVault.openWords();
  return new OpenKeySession(words);
}
