// The wallet vault: the recovery phrase sealed under the seed.v1 storage key
// before onboarding completes, so killing and relaunching keeps the wallet.
// The AES-256-GCM key lives in Keychain or Keystore (secureStore seam) and
// never returns to JS; the sealed blob is persisted by the blobStore seam.
// Meta rides inside the sealed payload: meta() decrypts metadata only and
// never hands out phrase bytes; openWords is the single decryption path and
// exists for the KeySession unlock flow.
import type { MlNetwork } from '../../modules/mojito-core';
import { getSecureStore } from './secureStore';
import { getBlobStore } from './blobStore';
import { STORAGE_KEYS } from './keys';

import type { WordCount } from '../keys/bip39';

export type VaultMeta = {
  v: 1;
  createdAt: number;
  network: MlNetwork;
  wordCount: WordCount;
  hasPassphrase: boolean;
};

/** What the app session holds after unlock: metadata, never seed bytes. */
export type WalletVaultHandle = { meta: VaultMeta };

type VaultPayload = { meta: VaultMeta; words: string[] };

const SEED_KEY = STORAGE_KEYS.seed;

function encodePayload(payload: VaultPayload): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

function decodePayload(bytes: Uint8Array): VaultPayload {
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as VaultPayload;
  if (parsed.meta?.v !== 1 || !Array.isArray(parsed.words)) {
    throw new Error('malformed vault payload');
  }
  return parsed;
}

export const walletVault = {
  /** Whether a sealed wallet exists, without decrypting anything. */
  async exists(): Promise<boolean> {
    const { store } = await getSecureStore();
    return store.keyExists(SEED_KEY);
  },

  /** Seal the phrase under seed.v1 and persist the blob. */
  async save(words: string[], meta: VaultMeta): Promise<void> {
    const { store } = await getSecureStore();
    const { store: blobs } = await getBlobStore();
    const blob = await store.seal(SEED_KEY, encodePayload({ meta, words }));
    await blobs.set(SEED_KEY, blob);
  },

  /** Metadata only; null when no wallet is sealed. Decrypts, never exposes
   *  phrase bytes. */
  async meta(): Promise<VaultMeta | null> {
    const { store } = await getSecureStore();
    const { store: blobs } = await getBlobStore();
    const blob = await blobs.get(SEED_KEY);
    if (!blob) return null;
    const payload = decodePayload(await store.open(SEED_KEY, blob));
    return payload.meta;
  },

  /** The decrypted phrase. Callers: the KeySession unlock flow only; no
   *  screen or state may hold the result. */
  async openWords(): Promise<string[]> {
    const { store } = await getSecureStore();
    const { store: blobs } = await getBlobStore();
    const blob = await blobs.get(SEED_KEY);
    if (!blob) throw new Error('vault is empty');
    return decodePayload(await store.open(SEED_KEY, blob)).words;
  },

  /** Remove the keystore key and the persisted blob: the wallet is gone. */
  async wipe(): Promise<void> {
    const { store } = await getSecureStore();
    const { store: blobs } = await getBlobStore();
    await blobs.remove(SEED_KEY);
    await store.wipe(SEED_KEY);
  },
};
