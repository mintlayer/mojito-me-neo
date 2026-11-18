// AddressIndexState persistence gate: corrupt stored JSON drops the state
// (a rescan re-derives everything) instead of wedging every address call,
// and invalid per-chain entries are dropped on load.
//   npx tsx src/storage/addressStore.test.ts
import { strict as assert } from 'node:assert/strict';

import { loadAddressIndex, parseAddressIndexState, saveAddressIndex } from './addressStore';
import { overrideAsyncStorageForTest, type AsyncStorageApi } from './asyncStorage';

function memoryApi(initial: string | null = null): AsyncStorageApi & { data: string | null } {
  const box = { data: initial };
  return {
    get data() {
      return box.data;
    },
    set data(value: string | null) {
      box.data = value;
    },
    getItem: async () => box.data,
    setItem: async (_key, value) => {
      box.data = value;
    },
    removeItem: async () => {
      box.data = null;
    },
  };
}

async function main() {
  // parseAddressIndexState: corrupt and non-object JSON drop to the empty
  // state; valid JSON passes through.
  assert.deepEqual(parseAddressIndexState(null), {});
  assert.deepEqual(parseAddressIndexState(''), {});
  assert.deepEqual(parseAddressIndexState('{not json'), {});
  assert.deepEqual(parseAddressIndexState('"a string"'), {});
  assert.deepEqual(parseAddressIndexState('[1,2]'), {});
  assert.deepEqual(parseAddressIndexState('{"mainnet":{"ml":{"receiving":3,"change":1}}}'), {
    mainnet: { ml: { receiving: 3, change: 1 } },
  });

  // The backed path survives corrupt JSON: load drops the state, the next
  // save rebuilds it.
  const corrupt = memoryApi('{truncated');
  overrideAsyncStorageForTest(corrupt);
  assert.deepEqual(await loadAddressIndex(), {});
  await saveAddressIndex('mainnet', 'ml', { receiving: 2, change: 1 });
  assert.deepEqual((await loadAddressIndex()).mainnet?.ml, { receiving: 2, change: 1 });

  // Entries failing validation (negative or non-integer indexes) are
  // dropped per chain, the valid ones stay.
  overrideAsyncStorageForTest(
    memoryApi(
      JSON.stringify({
        mainnet: { ml: { receiving: -1, change: 2 }, btc: { receiving: 1.5, change: 0 } },
        testnet: { ml: { receiving: 4, change: 0 } },
      }),
    ),
  );
  const state = await loadAddressIndex();
  assert.equal(state.mainnet?.ml, undefined);
  assert.equal(state.mainnet?.btc, undefined);
  assert.deepEqual(state.testnet?.ml, { receiving: 4, change: 0 });

  // Missing store (null api): the dev memory fallback keeps a roundtrip.
  overrideAsyncStorageForTest(null);
  await saveAddressIndex('testnet', 'btc', { receiving: 7, change: 0 });
  assert.deepEqual((await loadAddressIndex()).testnet?.btc, { receiving: 7, change: 0 });

  overrideAsyncStorageForTest(undefined);
  console.log('addressStore: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
