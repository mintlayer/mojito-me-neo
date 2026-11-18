// Persisted derivation indexes for the address manager: the next receiving
// and change index per chain and network. Public data only (addresses and
// counters, never key material), so plain JSON in AsyncStorage like
// appSettings; the same load-first dev memory fallback keeps the Node gate
// working and release builds honest (config/runtime.ts policy).
import { STORAGE_KEYS } from './keys';
import { loadAsyncStorage } from './asyncStorage';
import { devFallbackAllowed } from '../config/runtime';
import type { NetworkFlag } from '../config/endpoints';

/** One chain's derivation bookkeeping: next index to hand out per branch. */
export type ChainIndexes = { receiving: number; change: number };

/** The chains the wallet manages addresses for. */
export type ManagedChain = 'ml' | 'btc';

export type AddressIndexState = Partial<Record<NetworkFlag, Partial<Record<ManagedChain, ChainIndexes>>>>;

const STORAGE_KEY = STORAGE_KEYS.addressIndex;

// Process-lifetime copy for the Node gate and other tooling runtimes.
let memory: AddressIndexState | null = null;

async function loadRaw(): Promise<AddressIndexState> {
  const api = await loadAsyncStorage();
  if (api) {
    const json = await api.getItem(STORAGE_KEY);
    return parseAddressIndexState(json);
  }
  if (!devFallbackAllowed()) throw new Error('async storage unavailable');
  if (memory === null) memory = {};
  return memory;
}

/** Corrupt stored JSON drops the state (a rescan re-derives everything):
 *  a failed parse must not wedge every fresh/current/allAddresses call for
 *  the whole session. */
export function parseAddressIndexState(json: string | null): AddressIndexState {
  if (json === null || json.length === 0) return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as AddressIndexState;
    }
  } catch {
    // corrupt JSON falls through to the empty state
  }
  return {};
}

async function writeRaw(state: AddressIndexState): Promise<void> {
  const json = JSON.stringify(state);
  const api = await loadAsyncStorage();
  if (api) {
    await api.setItem(STORAGE_KEY, json);
    return;
  }
  if (!devFallbackAllowed()) throw new Error('async storage unavailable');
  if (memory === null) memory = {};
  memory = state;
}

/** The stored index state with corrupt entries dropped. */
export async function loadAddressIndex(): Promise<AddressIndexState> {
  const raw = await loadRaw();
  const out: AddressIndexState = {};
  for (const network of ['mainnet', 'testnet'] as NetworkFlag[]) {
    const perNetwork = raw[network];
    if (!perNetwork) continue;
    for (const chain of ['ml', 'btc'] as ManagedChain[]) {
      const indexes = perNetwork[chain];
      if (
        indexes &&
        Number.isInteger(indexes.receiving) && indexes.receiving >= 0 &&
        Number.isInteger(indexes.change) && indexes.change >= 0
      ) {
        (out[network] ??= {})[chain] = { receiving: indexes.receiving, change: indexes.change };
      }
    }
  }
  return out;
}

/** Merge a per-network, per-chain patch into the stored state. */
export async function saveAddressIndex(
  network: NetworkFlag,
  chain: ManagedChain,
  indexes: ChainIndexes,
): Promise<void> {
  const state = await loadRaw();
  const perNetwork = { ...state[network] };
  perNetwork[chain] = indexes;
  await writeRaw({ ...state, [network]: perNetwork });
}
