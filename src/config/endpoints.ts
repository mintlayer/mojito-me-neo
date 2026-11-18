// Per-network endpoint sets, selected by the active network flag. No URL is
// hardcoded in screens or providers. Facts and decisions live in the
// project decision log: mainnet indexer is live-verified (F6),
// broadcast stays null until the R3 decision lands (action item A1), the
// testnet base is pending action item A2 (R6), btcBase needs a btc-api
// deployment URL (F13), priceBase stays null because v1 mocks prices (R1).
// M2 status: the read side has live consumers: endpointsFor and
// currentNetwork drive the data providers (src/data/providers/index.ts) and
// setNetwork backs the persisted Settings network switch; FLAGS remains the
// feature-gate surface.

export type NetworkFlag = 'mainnet' | 'testnet';

export type EndpointsConfig = {
  /** Mintlayer indexer base (read-only, unauthenticated). */
  indexerBase: string | null;
  /** Keyset/offset batch endpoint when the indexer fronts one. */
  batchBase: string | null;
  /** ML transaction submission (R3: null until a public route is confirmed). */
  broadcastBase: string | null;
  /** btc-api Esplora-style proxy (F13: needs a deployment URL). */
  btcBase: string | null;
  /** Price and candles source (R1: null in v1, price provider is mocked). */
  priceBase: string | null;
  /** Card waitlist backend (R4: local-only in v1; null until it exists). */
  waitlistBase: string | null;
  /** bridge_v2 frontend API (F14: deployed base, integration lands in M4). */
  bridgeBase: string | null;
  /** Mintlayer explorer base for tx links; null on testnet pending A2/R6. */
  explorerBase: string | null;
  /** BTC explorer base for tx links (public mempool.space endpoints). */
  btcExplorerBase: string | null;
};

const MAINNET: EndpointsConfig = {
  indexerBase: 'https://api-server.mintlayer.org/api/v2',
  batchBase: null,
  broadcastBase: null,
  btcBase: null,
  priceBase: null,
  waitlistBase: null,
  bridgeBase: 'https://api.bridge.mintlayer.org/api/v1',
  explorerBase: 'https://explorer.mintlayer.org',
  btcExplorerBase: 'https://mempool.space',
};

// PENDING action item A2 (R6): the Mintlayer-operated testnet indexer URL is
// not documented; every field stays null so nothing silently points at a
// guess. Self-hosted fallback for local dev: http://127.0.0.1:13000/api/v2.
const TESTNET: EndpointsConfig = {
  indexerBase: null,
  batchBase: null,
  broadcastBase: null,
  btcBase: null,
  priceBase: null,
  waitlistBase: null,
  bridgeBase: 'https://api.bridge.mintlayer.org/api/v1',
  explorerBase: null,
  btcExplorerBase: 'https://mempool.space/testnet',
};

const NETWORKS: Record<NetworkFlag, EndpointsConfig> = { mainnet: MAINNET, testnet: TESTNET };

/** The app-level active network flag. Settings persistence lands in M1. */
let activeNetwork: NetworkFlag = 'mainnet';

export function setNetwork(network: NetworkFlag): void {
  activeNetwork = network;
}

export function currentNetwork(): NetworkFlag {
  return activeNetwork;
}

/** Endpoint set for the active network (or an explicit override). */
export function endpointsFor(network: NetworkFlag = activeNetwork): EndpointsConfig {
  return NETWORKS[network];
}

/** App-level feature flags that gate real backends behind decisions. */
export const FLAGS = {
  /** R3: sending is testnet-only on the mock broadcast until A1 resolves. */
  realBroadcastEnabled: false,
  /** R4 ship blocker: the local-only waitlist must be replaced before ship.
   *  Enforced in createWaitlistProvider: a release build with no configured
   *  waitlistBase refuses to construct the provider. */
  localWaitlistOnly: true,
  /** Default data-provider mode; EXPO_PUBLIC_DATA_MODE overrides to 'real'. */
  defaultDataMode: 'mock' as const,
} as const;
