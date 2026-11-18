// KeySession: access to the vault phrase for the duration of unlock-time
// derivations. Honest limits on the JavaScript side: the mnemonic is a
// string, and JS cannot zeroize strings, so release() only drops the
// session's reference and ends its ability to touch the phrase - the bytes
// linger until garbage collection runs. Derived account material is public
// (xpubs, addresses) and may be cached by the caller. Seed bytes and account
// privkeys never leave the withSeed closure (scrubbed on return) and never
// reach state, context or logs; the xpub helpers re-derive the 64-byte seed
// internally and drop it without a scrub, subject to the same GC limit.
import { mnemonicToSeed } from './bip39';
import { deriveMlAccount, type MlAccount, type MlDerivationNetwork } from './mlAccounts';
import { deriveBtcAccount } from './BtcKeyring';
import { walletVault } from '../storage/walletVault';

export interface KeySession {
  /** Opens the vault, derives the 64-byte BIP32 seed, runs the closure and
   *  releases the plaintext: nothing survives the returned promise. */
  withSeed<T>(fn: (seed: Uint8Array) => Promise<T>): Promise<T>;
  /** Account 0 Mintlayer extended public key blob (public, persistable). */
  xpubMl(network?: MlDerivationNetwork): Promise<Uint8Array>;
  /** Account 0 BTC extended public key in standard xpub form (public). */
  xpubBtc(network: 'mainnet' | 'testnet'): Promise<string>;
  /** Ends the session: every other method throws afterwards and the phrase
   *  reference is dropped. JS cannot zeroize the mnemonic string itself. */
  release(): void;
}

class OpenKeySession implements KeySession {
  private words: string[] | null;

  private released = false;

  constructor(words: string[]) {
    this.words = words;
  }

  private requireOpen(): string[] {
    if (this.released || this.words === null) throw new Error('key session released');
    return this.words;
  }

  async withSeed<T>(fn: (seed: Uint8Array) => Promise<T>): Promise<T> {
    const seed = await mnemonicToSeed(this.requireOpen());
    try {
      return await fn(seed);
    } finally {
      // Best-effort scrub of the closure-visible buffer; JS has no zeroize,
      // but overwriting keeps the bytes from lingering in a live view.
      seed.fill(0);
    }
  }

  private async mlAccount(network: MlDerivationNetwork): Promise<MlAccount> {
    return deriveMlAccount(this.requireOpen(), network);
  }

  async xpubMl(network: MlDerivationNetwork = 'mainnet'): Promise<Uint8Array> {
    return (await this.mlAccount(network)).xpub;
  }

  async xpubBtc(network: 'mainnet' | 'testnet'): Promise<string> {
    return (await deriveBtcAccount(this.requireOpen(), network)).xpub;
  }

  release(): void {
    // Idempotent: releasing twice is not a caller error.
    this.released = true;
    this.words = null;
  }
}

/**
 * Unlock-time session: decrypts the vault phrase (after PIN or biometrics)
 * and returns a short-lived handle. Wired in M2 per project decision log
 * D17: the real data providers open one to derive account xpubs
 * (src/data/providers/index.ts). There is at most one at a time; callers
 * call release() when done (the zeroize guarantee of withSeed does not
 * extend to the mnemonic string, see the header comment). One sanctioned UI
 * exception lives outside this handle: the backup reveal screen keeps the
 * words in onboarding state for the reveal and verify UI, and clears them
 * when the backup layer closes; the phrase never reaches the app session.
 */
export async function openKeySession(): Promise<KeySession> {
  const words = await walletVault.openWords();
  return new OpenKeySession(words);
}
