// PIN persistence with lockout (M1): the verifier is PBKDF2-SHA256 over the
// six digits with a random salt, 210k rounds; the PIN itself never persists,
// never logs and never crosses to the bindings. State survives app restart:
// the attempt counter and lock deadline live under the pin.meta.v1 key
// alongside the verifier. LOCK_ATTEMPTS failures arm LOCK_SECONDS, doubling
// per further failure burst until a successful verify resets the counter.
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { secureBytes } from '../keys/bip39';
import { getBlobStore } from './blobStore';
import { getSecureStore, type SecureStore } from './secureStore';
import { STORAGE_KEYS } from './keys';
import { bytesToHex, hexToBytes } from './hex';

export const LOCK_ATTEMPTS = 5;

export const LOCK_SECONDS = 30;

const PBKDF2_ROUNDS = 210_000;

const SALT_BYTES = 16;

const VERIFIER_BYTES = 32;

const PIN_KEY = STORAGE_KEYS.pinMeta;

export type PinState = {
  v: 1;
  verifierHash: string;
  salt: string;
  failedAttempts: number;
  lockedUntil: number | null;
};

export type PinVerdict = 'ok' | 'wrong' | 'locked' | 'unset';

function encodeState(state: PinState): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(state));
}

function decodeState(bytes: Uint8Array): PinState {
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as PinState;
  if (parsed.v !== 1 || typeof parsed.verifierHash !== 'string') {
    throw new Error('malformed pin state');
  }
  return parsed;
}

function deriveVerifier(pin: string, salt: Uint8Array): Uint8Array {
  return pbkdf2(sha256, new TextEncoder().encode(pin), salt, {
    c: PBKDF2_ROUNDS,
    dkLen: VERIFIER_BYTES,
  });
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = 0;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Seconds left on the current lockout, rounded up; 0 when not locked. */
function lockSecondsLeft(state: PinState, now: number): number {
  if (state.lockedUntil === null) return 0;
  return Math.max(0, Math.ceil((state.lockedUntil - now) / 1000));
}

class PinStore {
  private cache: PinState | null = null;

  private store: SecureStore | null = null;

  private async open(): Promise<PinState | null> {
    if (this.cache) return this.cache;
    if (!this.store) this.store = (await getSecureStore()).store;
    const { store: blobs } = await getBlobStore();
    const blob = await blobs.get(PIN_KEY);
    if (!blob) return null;
    this.cache = decodeState(await this.store.open(PIN_KEY, blob));
    return this.cache;
  }

  private async write(state: PinState | null): Promise<void> {
    if (!this.store) this.store = (await getSecureStore()).store;
    const { store: blobs } = await getBlobStore();
    this.cache = state;
    if (state === null) {
      await blobs.remove(PIN_KEY);
      await this.store.wipe(PIN_KEY);
      return;
    }
    const blob = await this.store.seal(PIN_KEY, encodeState(state));
    await blobs.set(PIN_KEY, blob);
  }

  /** Set (or replace) the PIN: fresh salt and verifier, attempts reset. */
  async setPin(pin: string): Promise<void> {
    if (!/^\d{6}$/.test(pin)) throw new Error('pin must be six digits');
    const salt = await secureBytes(SALT_BYTES);
    await this.write({
      v: 1,
      verifierHash: bytesToHex(deriveVerifier(pin, salt)),
      salt: bytesToHex(salt),
      failedAttempts: 0,
      lockedUntil: null,
    });
  }

  async verify(pin: string): Promise<PinVerdict> {
    const state = await this.open();
    // Unset is not wrong: a wallet whose PIN row is missing or half-written
    // (partial wipe, storage desync) must not fabricate failures. Wrong
    // verdicts feed the lockout; unset must not, or a fresh install of the
    // lock state could lock the wallet with no correct PIN existing.
    if (!state || !state.verifierHash) return 'unset';
    const now = Date.now();
    if (lockSecondsLeft(state, now) > 0) return 'locked';
    const given = deriveVerifier(pin, hexToBytes(state.salt));
    const stored = hexToBytes(state.verifierHash);
    return timingSafeEqual(given, stored) ? 'ok' : 'wrong';
  }

  /** Count a failed attempt; every LOCK_ATTEMPTS failures arm a lockout with
   *  double the previous burst duration. Refuses to write lockout state when
   *  no verifier exists: registerFailure is only meaningful after a verify()
   *  saw a real PIN state, and a {verifierHash:'', salt:''} row would be a
   *  permanent lockout no correct PIN could ever clear. */
  async registerFailure(): Promise<void> {
    const state = await this.open();
    if (!state || !state.verifierHash) return;
    const next: PinState = { ...state, failedAttempts: state.failedAttempts + 1 };
    const burst = Math.floor(next.failedAttempts / LOCK_ATTEMPTS);
    if (burst > 0 && next.failedAttempts % LOCK_ATTEMPTS === 0) {
      next.lockedUntil = Date.now() + LOCK_SECONDS * 1000 * 2 ** (burst - 1);
    }
    await this.write(next);
  }

  async resetAttempts(): Promise<void> {
    const state = await this.open();
    if (!state || (state.failedAttempts === 0 && state.lockedUntil === null)) return;
    await this.write({ ...state, failedAttempts: 0, lockedUntil: null });
  }

  /** Seconds the UI should count down right now. */
  async lockSecondsLeft(): Promise<number> {
    const state = await this.open();
    return state ? lockSecondsLeft(state, Date.now()) : 0;
  }

  /** Failed attempts since the last reset; drives the attempts-left copy. */
  async attempts(): Promise<number> {
    const state = await this.open();
    return state?.failedAttempts ?? 0;
  }

  /** Whether a usable PIN is configured (a stored row without a verifier is
   *  the unset state, not a configured PIN). */
  async exists(): Promise<boolean> {
    const state = await this.open();
    return state !== null && state.verifierHash !== '';
  }

  /** Settings sign-out: forget the verifier and its keystore key. */
  async wipe(): Promise<void> {
    await this.write(null);
  }
}

export const pinStore = new PinStore();
