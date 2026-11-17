// Encrypted-storage layer: seal and open over AES-256-GCM with a key resident
// in Keychain or Keystore (never returned to JS), plus wipe and keyExists.
// The native path runs through the MojitoCore module. The memory-only
// fallback is a test double for unit tests and tooling: it is deliberately
// NOT cryptography, just an authenticated roundtrip with the same shape. It
// is gated to dev/test runtimes: a release build without the native core
// fails loudly instead of sealing secrets with a fake cipher.
import type { SealedBlob } from '../../modules/mojito-core';
import { bytesToHex, hexToBytes } from './hex';
import { type StorageKeyId } from './keys';

/** Which implementation getSecureStore() handed out. */
export type SecureStoreKind = 'native' | 'memory';

declare const __DEV__: boolean | undefined;

/** Memory fallback is allowed only in dev/test runtimes: React Native dev
 *  builds (__DEV__), Expo Go, and non-RN tooling (Node tests, tsx). A release
 *  build must never silently fall back. */
function memoryFallbackAllowed(): boolean {
  return typeof __DEV__ === 'undefined' || __DEV__ === true;
}

export interface SecureStore {
  seal(keyId: StorageKeyId, plaintext: Uint8Array, gated: boolean): Promise<SealedBlob>;
  open(keyId: StorageKeyId, blob: SealedBlob): Promise<Uint8Array>;
  wipe(keyId: StorageKeyId): Promise<void>;
  keyExists(keyId: StorageKeyId): Promise<boolean>;
  /** Whether the resident key carries the native user-auth gate; never
   *  triggers a biometric prompt. */
  keyGated(keyId: StorageKeyId): Promise<boolean>;
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

type CoreModule = typeof import('../../modules/mojito-core');

let coreModule: CoreModule | null | undefined;

/** Resolve the native module once; null under Expo Go, Node or on failure. */
async function getCore(): Promise<CoreModule | null> {
  if (coreModule === undefined) {
    try {
      const m = await import('../../modules/mojito-core');
      coreModule = (await m.hasNativeCore()) ? m : null;
    } catch {
      coreModule = null;
    }
  }
  return coreModule;
}

let sharedMemory: SecureStore | null = null;

/**
 * The app-level store plus the kind it resolved to. Native-backed on dev
 * builds; memory fallback (unit tests, Expo Go, tooling) only where
 * memoryFallbackAllowed() holds. Release builds without the native core throw
 * so persistence can never degrade to the test double.
 */
export async function getSecureStore(): Promise<{ kind: SecureStoreKind; store: SecureStore }> {
  if (await getCore()) {
    return { kind: 'native', store: nativeStore };
  }
  if (!memoryFallbackAllowed()) throw new Error('native core unavailable');
  if (!sharedMemory) sharedMemory = createMemorySecureStore();
  return { kind: 'memory', store: sharedMemory };
}

const nativeStore: SecureStore = {
  async seal(keyId, plaintext, gated) {
    const core = await getCore();
    if (!core) throw new Error('native core unavailable');
    return core.MojitoCore.seal(keyId, plaintext, gated);
  },
  async open(keyId, blob) {
    const core = await getCore();
    if (!core) throw new Error('native core unavailable');
    return core.MojitoCore.open(keyId, blob);
  },
  async wipe(keyId) {
    const core = await getCore();
    if (!core) throw new Error('native core unavailable');
    await core.MojitoCore.wipe(keyId);
  },
  async keyExists(keyId) {
    const core = await getCore();
    if (!core) throw new Error('native core unavailable');
    return core.MojitoCore.keyExists(keyId);
  },
  async keyGated(keyId) {
    const core = await getCore();
    if (!core) throw new Error('native core unavailable');
    return core.MojitoCore.keyGated(keyId);
  },
};

function randomBytes(length: number): Uint8Array {
  const globalCrypto = (globalThis as { crypto?: { getRandomValues(b: Uint8Array): Uint8Array } }).crypto;
  if (globalCrypto?.getRandomValues) return globalCrypto.getRandomValues(new Uint8Array(length));
  // Last resort for environments without WebCrypto: a seeded xorshift. The
  // memory store is a test double, so determinism here is acceptable.
  const out = new Uint8Array(length);
  let state = (Date.now() ^ 0x9e3779b9) >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    out[i] = state & 0xff;
  }
  return out;
}

// FNV-1a again on purpose: the storage test double stays dependency-free and
// does not import from the mock data layer.
function fnv1a(data: number[], seed: number): number {
  let h = seed >>> 0;
  for (const byte of data) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Keystream from the key and IV via a seeded xorshift. Test double only. */
function keystream(key: Uint8Array, iv: Uint8Array, length: number): Uint8Array {
  const seed = fnv1a([...key, ...iv], 0x811c9dc5) || 1;
  const out = new Uint8Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    out[i] = state & 0xff;
  }
  return out;
}

/** Check bytes over key, IV and ciphertext; rejects any tampering or wrong key. */
function mockTag(key: Uint8Array, iv: Uint8Array, ct: Uint8Array): Uint8Array {
  const data = [...key, ...iv, ...ct];
  const out = new Uint8Array(TAG_BYTES);
  for (let round = 0; round < TAG_BYTES; round++) {
    out[round] = fnv1a(data, (0x811c9dc5 ^ (round * 0x9e3779b9)) >>> 0) & 0xff;
  }
  return out;
}

/** In-memory SecureStore with the same contract as the native path. */
export function createMemorySecureStore(): SecureStore {
  const keys = new Map<StorageKeyId, Uint8Array>();

  const loadOrCreateKey = (keyId: StorageKeyId): Uint8Array => {
    let key = keys.get(keyId);
    if (!key) {
      key = randomBytes(32);
      keys.set(keyId, key);
    }
    return key;
  };

  const xor = (data: Uint8Array, stream: Uint8Array): Uint8Array => {
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = data[i] ^ stream[i];
    return out;
  };

  return {
    // gated is accepted but ignored: the test double has no native gate.
    async seal(keyId, plaintext) {
      const key = loadOrCreateKey(keyId);
      const iv = randomBytes(IV_BYTES);
      const ct = xor(plaintext, keystream(key, iv, plaintext.length));
      return { v: 1, iv: bytesToHex(iv), ct: bytesToHex(ct), tag: bytesToHex(mockTag(key, iv, ct)) };
    },

    async open(keyId, blob) {
      const key = keys.get(keyId);
      const iv = hexToBytes(blob.iv);
      const ct = hexToBytes(blob.ct);
      const tag = hexToBytes(blob.tag);
      if (!key || tag.length !== TAG_BYTES || !timingSafeEqual(mockTag(key, iv, ct), tag)) {
        throw new Error(`open failed for ${keyId}`);
      }
      return xor(ct, keystream(key, iv, ct.length));
    },

    async wipe(keyId) {
      keys.delete(keyId);
    },

    async keyExists(keyId) {
      return keys.has(keyId);
    },

    // The memory double never gates: callers treat false as "no native gate".
    async keyGated() {
      return false;
    },
  };
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
