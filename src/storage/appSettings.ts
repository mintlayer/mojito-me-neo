// Persisted, non-secret security settings: the Settings screen toggles and
// the onboarding biometric choice ("Use PIN instead" persists as false, so a
// cold start does not re-offer biometrics on capable hardware). Plain JSON in
// AsyncStorage: nothing here is secret material, unlike the vault and the
// PIN verifier which cross the sealed-store seam.
import { STORAGE_KEYS } from './keys';
import { loadAsyncStorage } from './asyncStorage';
import { devFallbackAllowed } from '../config/runtime';

export type AppSettings = {
  /** Unlock leads with biometrics; null means never chosen (default to the
   *  device capability). A false here is the persisted "Use PIN instead". */
  biometrics: boolean | null;
  /** Lock the app when it leaves the foreground. */
  autoLock: boolean;
  /** Active-network switch (M2): selects the endpoint set and rebuilds the
   *  data providers. Mainnet is the default; the testnet base itself stays
   *  pending action item A2 (decisions.md R6). */
  testnet: boolean;
};

const SETTINGS_KEY = STORAGE_KEYS.settings;

// Process-lifetime copy for the Node gate and other tooling runtimes.
let memory: Partial<AppSettings> | null = null;

// Ordering matches the blobStore and secureStore seams: the real store is
// attempted first, so release builds with AsyncStorage keep persisting, and
// the throw only fires when no store exists AND the memory double is not
// allowed. Gating the whole read on devFallbackAllowed() would kill settings
// persistence (and with it the vault key's gate decision) in every release.
async function loadRaw(): Promise<Partial<AppSettings> | null> {
  const api = await loadAsyncStorage();
  if (api) {
    const json = await api.getItem(SETTINGS_KEY);
    return json ? (JSON.parse(json) as Partial<AppSettings>) : null;
  }
  if (!devFallbackAllowed()) throw new Error('async storage unavailable');
  if (memory === null) memory = {};
  return memory;
}

async function writeRaw(state: AppSettings): Promise<void> {
  const json = JSON.stringify(state);
  const api = await loadAsyncStorage();
  if (api) {
    await api.setItem(SETTINGS_KEY, json);
    return;
  }
  if (!devFallbackAllowed()) throw new Error('async storage unavailable');
  if (memory === null) memory = {};
  memory = state;
}

function coerce(raw: Partial<AppSettings> | null): AppSettings {
  return {
    biometrics: typeof raw?.biometrics === 'boolean' ? raw.biometrics : null,
    autoLock: raw?.autoLock !== false,
    testnet: raw?.testnet === true,
  };
}

/** The stored settings with defaults applied for missing or corrupt fields. */
export async function loadAppSettings(): Promise<AppSettings> {
  return coerce(await loadRaw());
}

/** Merge a patch into the stored settings and persist the result. */
export async function saveAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = coerce({ ...(await loadRaw()), ...patch });
  await writeRaw(next);
  return next;
}
