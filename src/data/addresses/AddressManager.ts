// Fresh-address policy and per-chain index bookkeeping (spec M2: gap scan to
// GAP_LIMIT, allocation persists, change branch reserved for send in M3).
// Derivation and usage probing are injected, so the manager is fully
// testable offline and the real providers wire it to the M1 keyrings and the
// chain clients.
//
// Policy: a receiving address counts as used once it has on-chain history,
// so the display address (always the current receiving address) is never
// reused after funding; the BIP44 gap limit governs discovery. freshReceivingAddress
// advances the counter and is what M3 calls after every outbound transaction.
import { loadAddressIndex, saveAddressIndex, type AddressIndexState, type ChainIndexes, type ManagedChain } from '../../storage/addressStore';
import type { NetworkFlag } from '../../config/endpoints';

/** BIP44 discovery gap: scanning stops after this many consecutive unused
 *  addresses past the last used one. */
export const GAP_LIMIT = 20;
export type { ManagedChain };

export type ChainDeriver = (branch: 0 | 1, index: number) => Promise<string>;

/** True when the address has any on-chain history. */
export type UsageProbe = (address: string) => Promise<boolean>;

export type AddressManagerOptions = {
  network: NetworkFlag;
  /** Overrides for the Node gate; defaults to the AsyncStorage-backed store. */
  load?: () => Promise<AddressIndexState>;
  save?: (network: NetworkFlag, chain: ManagedChain, indexes: ChainIndexes) => Promise<void>;
  derive: Record<ManagedChain, ChainDeriver>;
  /** Chain probes; a chain without one skips scanning and keeps its stored index. */
  probe?: Partial<Record<ManagedChain, UsageProbe>>;
};

export interface AddressManager {
  /** Gap scan for the chain; runs once per process, result persists. */
  ensureScanned(chain: ManagedChain): Promise<void>;
  /** Advance the receiving index (persisted) and return the new current address. */
  freshReceivingAddress(chain: ManagedChain): Promise<string>;
  /** The display address on Receive: the current receiving address. */
  currentReceivingAddress(chain: ManagedChain): Promise<string>;
  /** Next change address for send bookkeeping (consumed by M3). */
  allocateChangeAddress(chain: ManagedChain): Promise<string>;
  /** The next change address without advancing or persisting (quotes:
   *  a fee preview must not burn derivation indexes). */
  peekChangeAddress(chain: ManagedChain): Promise<string>;
  /** Every known receiving (up to and including current) and change address. */
  allAddresses(chain: ManagedChain): Promise<string[]>;
}

class ManagedAddresses {
  indexes: ChainIndexes = { receiving: 0, change: 0 };
  scanned = false;
  scanPromise: Promise<void> | null = null;
}

export function createAddressManager(opts: AddressManagerOptions): AddressManager {
  const load = opts.load ?? loadAddressIndex;
  const save = opts.save ?? saveAddressIndex;
  const chains: Record<ManagedChain, ManagedAddresses> = {
    ml: new ManagedAddresses(),
    btc: new ManagedAddresses(),
  };

  async function hydrate(chain: ManagedChain): Promise<void> {
    const state = await load();
    const indexes = state[opts.network]?.[chain];
    if (indexes) {
      chains[chain].indexes = { ...indexes };
      chains[chain].scanned = true;
    }
  }

  async function scan(chain: ManagedChain): Promise<void> {
    const probe = opts.probe?.[chain];
    if (!probe) {
      // No network probe wired (offline, or the chain backend is unconfigured):
      // the stored index stands, addresses still derive from the xpub.
      chains[chain].scanned = true;
      return;
    }
    const managed = chains[chain];
    let lastUsed = -1;
    let index = 0;
    // Sequential single-address requests, early exit at the gap limit
    // (rate-limit friendly per the M2 spec security note).
    for (; index < 500; index++) {
      const address = await opts.derive[chain](0, index);
      if (await probe(address)) {
        lastUsed = index;
      } else if (index - lastUsed >= GAP_LIMIT) {
        break;
      }
    }
    managed.indexes = { receiving: lastUsed + 1, change: managed.indexes.change };
    managed.scanned = true;
    await save(opts.network, chain, { ...managed.indexes });
  }

  async function ensureScanned(chain: ManagedChain): Promise<void> {
    const managed = chains[chain];
    if (managed.scanned) return;
    if (managed.scanPromise === null) {
      // A rejected scan resets the promise so a transient probe failure (or
      // a corrupt store read) can succeed on the next call, mirroring the
      // account promise in the real-mode data layer.
      managed.scanPromise = (async () => {
        await hydrate(chain);
        if (!managed.scanned) await scan(chain);
      })().catch((e: unknown) => {
        managed.scanPromise = null;
        throw e;
      });
    }
    await managed.scanPromise;
  }

  async function indexesOf(chain: ManagedChain): Promise<ChainIndexes> {
    await ensureScanned(chain);
    return chains[chain].indexes;
  }

  return {
    ensureScanned,

    async freshReceivingAddress(chain: ManagedChain): Promise<string> {
      const indexes = await indexesOf(chain);
      const next = { ...indexes, receiving: indexes.receiving + 1 };
      chains[chain].indexes = next;
      await save(opts.network, chain, next);
      return opts.derive[chain](0, next.receiving);
    },

    async currentReceivingAddress(chain: ManagedChain): Promise<string> {
      const indexes = await indexesOf(chain);
      return opts.derive[chain](0, indexes.receiving);
    },

    async allocateChangeAddress(chain: ManagedChain): Promise<string> {
      const indexes = await indexesOf(chain);
      const next = { ...indexes, change: indexes.change + 1 };
      chains[chain].indexes = next;
      await save(opts.network, chain, next);
      return opts.derive[chain](1, indexes.change);
    },

    async peekChangeAddress(chain: ManagedChain): Promise<string> {
      const indexes = await indexesOf(chain);
      return opts.derive[chain](1, indexes.change);
    },

    async allAddresses(chain: ManagedChain): Promise<string[]> {
      const indexes = await indexesOf(chain);
      const out: string[] = [];
      // Receiving branch up to and including the current address.
      for (let i = 0; i <= indexes.receiving; i++) out.push(await opts.derive[chain](0, i));
      // Change branch: only allocated ones (change is the next index to use).
      for (let i = 0; i < indexes.change; i++) out.push(await opts.derive[chain](1, i));
      return out;
    },
  };
}
