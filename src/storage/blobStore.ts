// Persistent store for sealed blobs. The M0 secureStore seam encrypts and
// decrypts with Keychain/Keystore resident keys but does not itself persist
// the ciphertext; this module holds it across app restarts through
// AsyncStorage. The memory fallback follows the secureStore policy: dev,
// Expo Go and Node tooling only; a release build without the native storage
// module refuses to persist (it must never silently lose a wallet).
import type { SealedBlob } from '../../modules/mojito-core';

import { loadAsyncStorage } from './asyncStorage';
import { devFallbackAllowed } from '../config/runtime';

export type BlobStoreKind = 'native' | 'memory';

export interface BlobStore {
  get(keyId: string): Promise<SealedBlob | null>;
  set(keyId: string, blob: SealedBlob): Promise<void>;
  remove(keyId: string): Promise<void>;
}

function decodeBlob(json: string): SealedBlob | null {
  try {
    const raw = JSON.parse(json) as { v?: number; iv?: string; ct?: string; tag?: string };
    if (raw.v !== 1 || !raw.iv || !raw.ct || !raw.tag) return null;
    return { v: 1, iv: raw.iv, ct: raw.ct, tag: raw.tag };
  } catch {
    return null;
  }
}

const nativeBlobStore: BlobStore = {
  async get(keyId) {
    const api = await loadAsyncStorage();
    if (!api) throw new Error('async storage unavailable');
    const json = await api.getItem(keyId);
    return json ? decodeBlob(json) : null;
  },
  async set(keyId, blob) {
    const api = await loadAsyncStorage();
    if (!api) throw new Error('async storage unavailable');
    await api.setItem(keyId, JSON.stringify(blob));
  },
  async remove(keyId) {
    const api = await loadAsyncStorage();
    if (!api) throw new Error('async storage unavailable');
    await api.removeItem(keyId);
  },
};

function createMemoryBlobStore(): BlobStore {
  const records = new Map<string, string>();
  return {
    async get(keyId) {
      const json = records.get(keyId);
      return json ? decodeBlob(json) : null;
    },
    async set(keyId, blob) {
      records.set(keyId, JSON.stringify(blob));
    },
    async remove(keyId) {
      records.delete(keyId);
    },
  };
}

let sharedMemory: BlobStore | null = null;

/**
 * The app-level blob store plus the kind it resolved to. AsyncStorage-backed
 * on dev and release builds; memory fallback only where the secureStore
 * memory double is also allowed.
 */
export async function getBlobStore(): Promise<{ kind: BlobStoreKind; store: BlobStore }> {
  if (await loadAsyncStorage()) return { kind: 'native', store: nativeBlobStore };
  if (!devFallbackAllowed()) throw new Error('async storage unavailable');
  if (!sharedMemory) sharedMemory = createMemoryBlobStore();
  return { kind: 'memory', store: sharedMemory };
}
