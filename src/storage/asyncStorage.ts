// Shared AsyncStorage seam for the plain-JSON stores (blob payloads and app
// settings). Lazy package import plus one dead-shim probe: the package
// exports a shim outside React Native (for example under Node tooling) whose
// calls reject on use, so a silenced probe call tells the difference between
// a working native store and a dead shim.
export type AsyncStorageApi = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

let asyncStorage: AsyncStorageApi | null | undefined;

async function probeStorage(api: AsyncStorageApi): Promise<AsyncStorageApi | null> {
  try {
    await api.getItem('__mojito_probe__');
    return api;
  } catch {
    return null;
  }
}

/** Resolve AsyncStorage once; null when the package is missing or dead. */
export async function loadAsyncStorage(): Promise<AsyncStorageApi | null> {
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
