// Gate for the app settings store ordering: a working AsyncStorage wins
// before any devFallbackAllowed check (release builds must keep persisting
// settings, which carry the vault key's gate decision), the memory double
// applies only where the dev fallback is allowed, and a release build with
// no store throws instead of silently dropping writes.
//   tsx src/storage/appSettings.test.ts
import { strict as assert } from 'node:assert/strict';

import { overrideAsyncStorageForTest } from './asyncStorage';
import type { AsyncStorageApi } from './asyncStorage';
import { STORAGE_KEYS } from './keys';
import { loadAppSettings, saveAppSettings } from './appSettings';

/** Metro folds __DEV__ to false in release builds; the Node gate folds it
 *  here to exercise the same policy branch in devFallbackAllowed(). */
function setRelease(release: boolean): void {
  (globalThis as { __DEV__?: boolean | undefined }).__DEV__ = release ? false : true;
}

async function main() {
  // Dev tooling without a store (the dead Node shim resolves null): the
  // process-lifetime memory double carries the settings.
  overrideAsyncStorageForTest(undefined);
  setRelease(false);
  assert.deepEqual(await loadAppSettings(), { biometrics: null, autoLock: true, testnet: false, backupVerified: false });
  await saveAppSettings({ biometrics: false, autoLock: false, testnet: true });
  assert.deepEqual(await loadAppSettings(), { biometrics: false, autoLock: false, testnet: true, backupVerified: false });

  // Release build with a working AsyncStorage: reads and writes must hit
  // the real store, never the memory double (which still holds the dev
  // write above, so the roundtrip value discriminates the two paths).
  const backing = new Map<string, string>();
  const native: AsyncStorageApi = {
    async getItem(key) {
      return backing.get(key) ?? null;
    },
    async setItem(key, value) {
      backing.set(key, value);
    },
    async removeItem(key) {
      backing.delete(key);
    },
  };
  overrideAsyncStorageForTest(native);
  setRelease(true);
  await saveAppSettings({ biometrics: true, testnet: true });
  assert.deepEqual(await loadAppSettings(), { biometrics: true, autoLock: true, testnet: true, backupVerified: false });
  assert.deepEqual(JSON.parse(backing.get(STORAGE_KEYS.settings) ?? '{}'), {
    biometrics: true,
    autoLock: true,
    testnet: true,
    backupVerified: false,
  });

  // Release build with no store: both directions fail loudly, before any
  // memory fallback can mask the loss.
  overrideAsyncStorageForTest(null);
  await assert.rejects(() => loadAppSettings(), /async storage unavailable/);
  await assert.rejects(() => saveAppSettings({ biometrics: false }), /async storage unavailable/);

  // Same missing store under the dev policy still falls back to memory.
  setRelease(false);
  assert.deepEqual(await loadAppSettings(), { biometrics: false, autoLock: false, testnet: true, backupVerified: false });

  console.log('appSettings.test.ts: release store-first ordering, dev memory fallback, release no-store throw all pass');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
