// The wallet vault: the recovery phrase sealed under a keystore-resident
// key before onboarding completes, so killing and relaunching keeps the
// wallet.
//
// Slot lifecycle: the vault has two fixed storage keys, seed.v1 and seed.v2,
// and exactly one of them is live at a time (the one whose sealed blob
// exists). Fresh onboarding seals under seed.v1. upgradeGating re-keys the
// payload when the persisted biometrics choice and the live key's native
// gate disagree, in both directions: it seals into the slot the live one is
// not (fixed target, one legacy seed.v1 cohort, so the first upgrade lands
// on seed.v2 and later flips ping-pong between the two), persists the new
// blob, opens it back and requires byte-equal plaintext, and only after
// that verified readback deletes the old key and blob. Any failure before
// the verified readback removes the new-slot remnants (blob first, so a
// partial remnant is at most an unused key, never a blob without its key)
// and throws VaultUpgradeError: the old vault stays fully intact and the
// unlock flow surfaces one retryable message. If a crash lands between the
// verified readback and the old-slot delete, both blobs exist for a while;
// reads prefer seed.v2, and the payloads are byte-identical there, so at
// worst one redundant re-seal converges and the leftover key is inert.
//
// The AES-256-GCM key lives in Keychain or Keystore (secureStore seam) and
// never returns to JS; the sealed blob is persisted by the blobStore seam.
// Meta rides inside the sealed payload: meta() decrypts metadata only and
// never hands out phrase bytes; openWords is the single decryption path. Its
// M1 callers are the backup reveal and the unlock gating upgrade; the
// KeySession consumer arrives in M2 (decisions.md D10).
import type { MlNetwork, SealedBlob } from '../../modules/mojito-core';
import { getSecureStore } from './secureStore';
import type { SecureStore } from './secureStore';
import { getBlobStore } from './blobStore';
import type { BlobStore } from './blobStore';
import { STORAGE_KEYS } from './keys';
import type { StorageKeyId } from './keys';

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

/** The gating re-seal did not complete and the old vault is fully intact;
 *  the next unlock retries it. Unlock surfaces this as one retryable
 *  message, never as the terminal phrase-restore guidance. */
export class VaultUpgradeError extends Error {}

const SEED_KEY = STORAGE_KEYS.seed;

// Read preference order for the two fixed slots. It matters only when both
// blobs exist (crash between the verified readback and the old-slot delete,
// see the slot lifecycle note in the module header): seed.v2 wins there and
// the payloads are byte-identical, so the preference is always safe.
const LIVE_KEYS: readonly StorageKeyId[] = [STORAGE_KEYS.seedUpgrade, SEED_KEY];

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

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The live slot: the fixed key whose sealed blob exists. Used by every
 *  read and by the re-seal to pick its deletion target. */
async function liveSlot(
  store: SecureStore,
  blobs: BlobStore,
): Promise<{ key: StorageKeyId; blob: SealedBlob } | null> {
  for (const key of LIVE_KEYS) {
    const blob = await blobs.get(key);
    if (blob) return { key, blob };
  }
  return null;
}

export const walletVault = {
  /** Whether a sealed wallet exists, without decrypting anything. */
  async exists(): Promise<boolean> {
    const { store } = await getSecureStore();
    for (const key of LIVE_KEYS) {
      if (await store.keyExists(key)) return true;
    }
    return false;
  },

  /** Whether the live vault key actually carries the native user-auth gate.
   *  Read without any decryption or biometric prompt; drives the
   *  gate-alignment upgrade check at unlock. False without a vault. */
  async keyGated(): Promise<boolean> {
    const { store } = await getSecureStore();
    const { store: blobs } = await getBlobStore();
    const slot = await liveSlot(store, blobs);
    if (!slot) return false;
    return store.keyGated(slot.key);
  },

  /** Seal the phrase under the fresh-onboarding slot (seed.v1) and persist
   *  the blob. `gated` travels to the native key creation: the vault key is
   *  auth-gated only when the wallet chose biometrics on the Secure screen
   *  (the persisted choice), never because hardware happens to have
   *  biometrics. Later gate flips go through upgradeGating, not save. */
  async save(words: string[], meta: VaultMeta, gated: boolean): Promise<void> {
    const { store } = await getSecureStore();
    const { store: blobs } = await getBlobStore();
    const blob = await store.seal(SEED_KEY, encodePayload({ meta, words }), gated);
    await blobs.set(SEED_KEY, blob);
  },

  /** Re-seal the payload under the slot the live one is not, with
   *  `targetGated` as the native gate, and return the new key id. The new
   *  blob is persisted and read back (byte-equal plaintext required)
   *  before the old key and blob are deleted. Any failure before the
   *  verified readback removes the new-slot remnants and throws
   *  VaultUpgradeError, leaving the old vault fully intact so the caller
   *  can surface a retryable failure. */
  async upgradeGating(words: string[], meta: VaultMeta, targetGated: boolean): Promise<StorageKeyId> {
    const { store } = await getSecureStore();
    const { store: blobs } = await getBlobStore();
    const live = await liveSlot(store, blobs);
    if (!live) throw new VaultUpgradeError('no live vault slot to upgrade');
    const target: StorageKeyId = live.key === SEED_KEY ? STORAGE_KEYS.seedUpgrade : SEED_KEY;
    const payload = encodePayload({ meta, words });
    try {
      const blob = await store.seal(target, payload, targetGated);
      await blobs.set(target, blob);
      const persisted = await blobs.get(target);
      if (!persisted) throw new Error(`re-sealed blob did not persist under ${target}`);
      if (!bytesEqual(await store.open(target, persisted), payload)) {
        throw new Error(`re-sealed payload under ${target} does not read back byte-equal`);
      }
    } catch {
      // Best-effort remnant cleanup, blob first: a partial remnant is then
      // at most an unused key, never a blob without its key. Whatever
      // survives is inert anyway, because the live slot stays authoritative
      // until this slot verifies and a retry overwrites it before trust.
      try {
        await blobs.remove(target);
        await store.wipe(target);
      } catch {
        // The old vault is untouched either way; the rethrow below is the
        // single signal the caller acts on.
      }
      throw new VaultUpgradeError(`vault re-seal under ${target} failed; the old vault is intact`);
    }
    // Verified readback done: only now drop the old slot, blob first.
    try {
      await blobs.remove(live.key);
      await store.wipe(live.key);
    } catch {
      // The wallet is already live on the verified new slot; a failed
      // old-slot delete leaves at most a consistent stale pair that reads
      // never prefer once the new slot is the preferred one. Surface
      // retryable regardless: the flip did not fully settle.
      throw new VaultUpgradeError(`old vault slot ${live.key} cleanup failed; the wallet is on ${target}`);
    }
    return target;
  },

  /** Metadata only; null when no wallet is sealed. Decrypts, never exposes
   *  phrase bytes. */
  async meta(): Promise<VaultMeta | null> {
    const { store } = await getSecureStore();
    const { store: blobs } = await getBlobStore();
    const slot = await liveSlot(store, blobs);
    if (!slot) return null;
    const payload = decodePayload(await store.open(slot.key, slot.blob));
    return payload.meta;
  },

  /** The decrypted phrase. M1 callers: the unlock gating upgrade and the
   *  backup reveal screen, which is the one sanctioned UI exception: it
   *  holds the words in onboarding state for the reveal and verify UI and
   *  clears them when the backup layer closes (KeySession lands in M2). */
  async openWords(): Promise<string[]> {
    const { store } = await getSecureStore();
    const { store: blobs } = await getBlobStore();
    const slot = await liveSlot(store, blobs);
    if (!slot) throw new Error('vault is empty');
    return decodePayload(await store.open(slot.key, slot.blob)).words;
  },

  /** Remove the keystore keys and the persisted blobs of both slots: the
   *  wallet is gone. Blob first per slot, so a partial wipe cannot leave a
   *  blob without its key. */
  async wipe(): Promise<void> {
    const { store } = await getSecureStore();
    const { store: blobs } = await getBlobStore();
    for (const key of LIVE_KEYS) {
      await blobs.remove(key);
      await store.wipe(key);
    }
  },
};
