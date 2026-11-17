// Persisted, non-secret security settings: the Settings screen toggles and
// the onboarding biometric choice ("Use PIN instead" persists as false, so a
// cold start does not re-offer biometrics on capable hardware). Plain JSON in
// AsyncStorage: nothing here is secret material, unlike the vault and the
// PIN verifier which cross the sealed-store seam.
import { STORAGE_KEYS } from './keys';

export type AppSettings = {
  /** Unlock leads with biometrics; null means never chosen (default to the
   *  device capability). A false here is the persisted "Use PIN instead". */
  biometrics: boolean | null;
  /** Lock the app when it leaves the foreground. */
  autoLock: boolean;
};

const SETTINGS_KEY = STORAGE_KEYS.settings;

declare const __DEV__: boolean | undefined;

function memoryFallbackAllowed(): boolean {
  return typeof __DEV__ === 'undefined' || __DEV__ === true;
}

type AsyncStorageApi = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

let asyncStorage: AsyncStorageApi | null | undefined;

async function loadApi(): Promise<AsyncStorageApi | null> {
  if (asyncStorage === undefined) {
    try {
      const mod = await import('@react-native-async-storage/async-storage');
      const api = mod.default as unknown;
      asyncStorage =
        api && typeof (api as AsyncStorageApi).getItem === 'function'
          ? await probeStorage(api as AsyncStorageApi)
          : null;
    } catch {
      asyncStorage = null;
    }
  }
  return asyncStorage;
}

/** One silenced probe call tells a working native store from the dead shim
 *  the package exports outside React Native (same probe as blobStore). */
async function probeStorage(api: AsyncStorageApi): Promise<AsyncStorageApi | null> {
  try {
    await api.getItem('__mojito_probe__');
    return api;
  } catch {
    return null;
  }
}

// Process-lifetime copy for the Node gate and other tooling runtimes.
let memory: Partial<AppSettings> | null = null;

async function loadRaw(): Promise<Partial<AppSettings> | null> {
  if (!memoryFallbackAllowed()) throw new Error('async storage unavailable');
  const api = await loadApi();
  if (api) {
    const json = await api.getItem(SETTINGS_KEY);
    return json ? (JSON.parse(json) as Partial<AppSettings>) : null;
  }
  if (memory === null) memory = {};
  return memory;
}

async function writeRaw(state: AppSettings): Promise<void> {
  if (!memoryFallbackAllowed()) throw new Error('async storage unavailable');
  const json = JSON.stringify(state);
  const api = await loadApi();
  if (api) {
    await api.setItem(SETTINGS_KEY, json);
    return;
  }
  if (memory === null) memory = {};
  memory = state;
}

function coerce(raw: Partial<AppSettings> | null): AppSettings {
  return {
    biometrics: typeof raw?.biometrics === 'boolean' ? raw.biometrics : null,
    autoLock: raw?.autoLock !== false,
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
