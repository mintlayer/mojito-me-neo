// AddressManager gate: gap scan against a probe stub, fresh-address
// monotonicity, persistence across restarts and the no-probe degradation.
//   npx tsx src/data/addresses/addressManager.test.ts
import { strict as assert } from 'node:assert/strict';

import { GAP_LIMIT, createAddressManager } from './AddressManager';
import { loadAddressIndex, saveAddressIndex, type AddressIndexState, type ChainIndexes, type ManagedChain } from '../../storage/addressStore';
import type { NetworkFlag } from '../../config/endpoints';

const NETWORK: NetworkFlag = 'mainnet';

function deriver(chain: 'ml' | 'btc') {
  return async (branch: 0 | 1, index: number): Promise<string> => `${chain}-${branch}-${index}`;
}

/** In-memory persistence double standing in for AsyncStorage. */
function memoryStore() {
  let state: AddressIndexState = {};
  return {
    load: async (): Promise<AddressIndexState> => state,
    save: async (network: NetworkFlag, chain: ManagedChain, indexes: ChainIndexes) => {
      state = { [network]: { ...state[network], [chain]: { ...indexes } } };
    },
    read: (): AddressIndexState => state,
  };
}

async function main() {
  // Gap scan: 3 used receiving addresses, then a run of unused ones. The scan
  // must stop GAP_LIMIT addresses past the last used one and set the next
  // receiving index to the first unused address.
  {
    const store = memoryStore();
    const probed: string[] = [];
    const manager = createAddressManager({
      network: NETWORK,
      load: store.load,
      save: store.save,
      derive: { ml: deriver('ml'), btc: deriver('btc') },
      probe: {
        ml: async (address) => {
          probed.push(address);
          return ['ml-0-0', 'ml-0-1', 'ml-0-2'].includes(address);
        },
      },
    });

    await manager.ensureScanned('ml');
    assert.equal((await manager.currentReceivingAddress('ml')), 'ml-0-3');
    // Early exit at the boundary: 3 used addresses, then GAP_LIMIT consecutive
    // unused probes end the walk (last probe at index lastUsed + GAP_LIMIT).
    assert.equal(probed.length, 3 + GAP_LIMIT);
    const saved = store.read()[NETWORK]?.ml;
    assert.deepEqual(saved, { receiving: 3, change: 0 });

    // allAddresses covers the used receiving set; change branch empty.
    assert.deepEqual(await manager.allAddresses('ml'), ['ml-0-0', 'ml-0-1', 'ml-0-2', 'ml-0-3']);
  }

  // Fresh address monotonicity: every call advances and persists, the
  // current address moves with it.
  {
    const store = memoryStore();
    const manager = createAddressManager({
      network: NETWORK,
      load: store.load,
      save: store.save,
      derive: { ml: deriver('ml'), btc: deriver('btc') },
    });
    assert.equal(await manager.currentReceivingAddress('ml'), 'ml-0-0');
    assert.equal(await manager.freshReceivingAddress('ml'), 'ml-0-1');
    assert.equal(await manager.freshReceivingAddress('ml'), 'ml-0-2');
    assert.equal(await manager.currentReceivingAddress('ml'), 'ml-0-2');
    assert.deepEqual(store.read()[NETWORK]?.ml, { receiving: 2, change: 0 });
    // allAddresses includes every allocated receiving index.
    assert.deepEqual(await manager.allAddresses('ml'), ['ml-0-0', 'ml-0-1', 'ml-0-2']);
  }

  // Change bookkeeping derives branch 1 and advances its own counter.
  {
    const store = memoryStore();
    const manager = createAddressManager({
      network: NETWORK,
      load: store.load,
      save: store.save,
      derive: { ml: deriver('ml'), btc: deriver('btc') },
    });
    assert.equal(await manager.allocateChangeAddress('ml'), 'ml-1-0');
    assert.equal(await manager.allocateChangeAddress('ml'), 'ml-1-1');
    assert.deepEqual(await manager.allAddresses('ml'), ['ml-0-0', 'ml-1-0', 'ml-1-1']);
    assert.deepEqual(store.read()[NETWORK]?.ml, { receiving: 0, change: 2 });
  }

  // Chains are independent and the state is per network.
  {
    const store = memoryStore();
    const manager = createAddressManager({
      network: NETWORK,
      load: store.load,
      save: store.save,
      derive: { ml: deriver('ml'), btc: deriver('btc') },
    });
    await manager.freshReceivingAddress('btc');
    await manager.freshReceivingAddress('ml');
    assert.equal(await manager.currentReceivingAddress('btc'), 'btc-0-1');
    assert.equal(await manager.currentReceivingAddress('ml'), 'ml-0-1');
    assert.deepEqual(store.read()[NETWORK]?.btc, { receiving: 1, change: 0 });
    assert.deepEqual(store.read()[NETWORK]?.ml, { receiving: 1, change: 0 });
  }

  // A previously stored index survives a restart (fresh manager, no probe).
  {
    const store = memoryStore();
    const first = createAddressManager({
      network: NETWORK,
      load: store.load,
      save: store.save,
      derive: { ml: deriver('ml'), btc: deriver('btc') },
      probe: { ml: async (a) => a === 'ml-0-7' },
    });
    await first.ensureScanned('ml');
    assert.equal(await first.currentReceivingAddress('ml'), 'ml-0-8');

    const restarted = createAddressManager({
      network: NETWORK,
      load: store.load,
      save: store.save,
      derive: { ml: deriver('ml'), btc: deriver('btc') },
      // No probe wired: the persisted index stands, no network needed.
    });
    await restarted.ensureScanned('ml');
    assert.equal(await restarted.currentReceivingAddress('ml'), 'ml-0-8');
    // allAddresses covers the full scanned receiving set, 0..current.
    assert.deepEqual(
      await restarted.allAddresses('ml'),
      Array.from({ length: 9 }, (_, i) => `ml-0-${i}`),
    );
  }

  // The AsyncStorage-backed store round-trips through its own seam.
  {
    await saveAddressIndex(NETWORK, 'ml', { receiving: 4, change: 2 });
    const state = await loadAddressIndex();
    assert.deepEqual(state[NETWORK]?.ml, { receiving: 4, change: 2 });
  }

  // Empty history (fresh wallet): the scan finds nothing used and keeps 0.
  {
    const store = memoryStore();
    let probes = 0;
    const manager = createAddressManager({
      network: NETWORK,
      load: store.load,
      save: store.save,
      derive: { ml: deriver('ml'), btc: deriver('btc') },
      probe: {
        ml: async () => {
          probes += 1;
          return false;
        },
      },
    });
    await manager.ensureScanned('ml');
    assert.equal(await manager.currentReceivingAddress('ml'), 'ml-0-0');
    // Nothing used: the walk stops once the gap limit of unused probes is met.
    assert.equal(probes, GAP_LIMIT);
  }

  console.log('addressManager: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
