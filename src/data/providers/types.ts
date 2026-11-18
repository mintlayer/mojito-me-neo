// Single source for the data-provider seams. Every later milestone implements
// against these interfaces; the mock | real mode switch lives in
// src/data/providers/index.ts. Shapes mirror the gap interfaces in
// missing-architecture.md so the real implementations slot in unchanged.
import type { ChainName, Tone } from '../../theme';
import type { IconName } from '../../ui/icons';
import type { StepState } from '../../ui/StepState';

export type ProviderMode = 'mock' | 'real';

// Portfolio and home
export type Portfolio = { total: string; change: number; delta: string; spark: number[] };

export type AssetRow = {
  sym: string; name: string; chain: ChainName;
  amt: number; price: number; change: number; value: number; spark: number[];
  /** True when the backend for this chain is unconfigured: the amount and
   *  value are unknown, not zero. The row renders an explicit unavailable
   *  state and contributes nothing to the total. */
  unavailable?: boolean;
};

export type ActivityRow = { icon: IconName; title: string; sub: string; tone: Tone; time: string; state: string; /** True while the row is still settling; drives the live colour. */ live: boolean };

/** NFT gallery row (Home NFTs tab, real mode via NftService; mock mode ships
 *  an empty gallery until an account holds NFTs). */
export type NftRow = {
  id: string;
  name: string | null;
  ticker: string | null;
  owner: string | null;
  mediaUri: string | null;
  iconUri: string | null;
  /** True when the metadata lookup failed; drives the metadataMissing copy. */
  metadataMissing: boolean;
};

// DEX market
export type MarketSummary = {
  pair: string; last: string; change: number; btc: string;
  high: string; low: string; volume: string; price: number;
};

export type BookLevel = { p: number; s: number; t: number };

// Swap and bridge fixture rows
export type HtlcStep = { label: string; detail: string; state: StepState; note?: string };
export type SwapStat = [string, string];
export type BridgeChain = { name: ChainName; sym: string };
export type BridgeRouteStep = { label: string; detail: string; icon: IconName; eta: string };
export type BridgeQuoteLine = [string, string];

// Card
export type WaitlistStatus = { taken: number; total: number };
export type DappsSummary = { active: number };
export type CardFeature = { icon: IconName; title: string; detail: string; tone: Tone };
export type CardTier = { name: string; stake: string; cashback: string; active?: boolean };

// Send and receive
export type FeeTierId = 'economy' | 'standard' | 'fast';
export type FeeSchedule = Record<FeeTierId, { cost: number }>;
export type Contact = { name: string; address: string };

// Profile
export type Profile = { name: string; initial: string; address: string; chains: number };

// Prices (missing-architecture gap 1, R1: mock in v1)
export type PriceRange = '1H' | '4H' | '1D' | '1W' | '1M' | '1Y' | 'ALL';
export type PricePoint = { t: number; p: number }; // unix seconds, USD
export type PriceSnapshot = {
  tokenId: string; // ML native id or mmltk...
  symbol: string;
  usd: string; // decimal string, never float math in state
  change24hPct: number;
  updatedAt: number;
};
export type Candle = { t: number; o: string; h: string; l: string; c: string; v: string }; // decimal strings per gap-1: parse at render, never float math in state
export type CandleInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export interface PriceProvider {
  getSnapshots(tokenIds: string[]): Promise<PriceSnapshot[]>;
  getHistory(tokenId: string, range: PriceRange): Promise<PricePoint[]>;
  getCandles(pair: string, interval: CandleInterval): Promise<Candle[]>;
}

// Broadcast (missing-architecture gap 3, R3: testnet-only mock in v1)
export type MlTxStatus = 'pending' | 'confirmed' | 'not-found';

export interface BroadcastProvider {
  broadcastMl(signedTxHex: string): Promise<{ txId: string }>;
  getMlStatus(txId: string): Promise<MlTxStatus>;
}

// Waitlist (missing-architecture gap 4, R4: local-only in v1, real backend before ship)
export type WaitlistResult =
  | { ok: true; position: number | null } // position when the backend reports one
  | { ok: false; reason: 'invalid' | 'duplicate' | 'unavailable' };

export interface WaitlistProvider {
  join(email: string): Promise<WaitlistResult>;
}

// Bridge (missing-architecture gap 5, R5: bridge_v2 api-server integration)
export type BridgeRouteDirection = 'E2M' | 'M2E';
export type BridgeQuoteRequest = { route: BridgeRouteDirection; token: string; amount: string; destAddr: string };
export type BridgeQuote = {
  feePct: string; feeAmount: string; minAmount: string;
  etaSeconds: number; destContractOrAddress: string;
};
export type BridgeHandle = { id: string; createdAt: number };
export type BridgeState = 'awaiting-deposit' | 'attesting' | 'minted' | 'released' | 'expired' | 'failed';

export interface BridgeProvider {
  quote(req: BridgeQuoteRequest): Promise<BridgeQuote>;
  initiate(req: BridgeQuoteRequest): Promise<BridgeHandle>;
  status(handle: BridgeHandle): Promise<BridgeState>;
}

export interface WalletData {
  // portfolio and home. The force flag bypasses the real-mode home bundle
  // cache: pull-to-refresh must not resolve on seconds-old data.
  getPortfolio(opts?: { force?: boolean }): Promise<Portfolio>;
  getAssets(opts?: { force?: boolean }): Promise<AssetRow[]>;
  getAssetSymbols(): Promise<string[]>;
  getAssetBalances(): Promise<Record<string, string>>;
  getActivity(limit: number): Promise<ActivityRow[]>;
  getNfts(opts?: { force?: boolean }): Promise<NftRow[]>;
  getNetworks(): Promise<ChainName[]>;
  getRanges(): Promise<PriceRange[]>;
  getProfile(): Promise<Profile>;
  // dex
  getMarket(pair: string): Promise<MarketSummary>;
  getOrderBook(pair: string): Promise<{ asks: BookLevel[]; bids: BookLevel[] }>;
  getTimeframes(): Promise<CandleInterval[]>;
  // swap
  getHtlcSteps(): Promise<HtlcStep[]>;
  getSwapStats(): Promise<SwapStat[]>;
  // bridge
  getBridgeChains(): Promise<BridgeChain[]>;
  getBridgeRoute(): Promise<BridgeRouteStep[]>;
  getBridgeQuote(): Promise<BridgeQuoteLine[]>;
  // card
  getWaitlist(): Promise<WaitlistStatus>;
  getDapps(): Promise<DappsSummary>;
  getCardFeatures(): Promise<CardFeature[]>;
  getCardTiers(): Promise<CardTier[]>;
  // send and receive
  getFees(): Promise<FeeSchedule>;
  getContacts(): Promise<Contact[]>;
  getAddresses(): Promise<Partial<Record<ChainName, string>>>;
  getChainGlyphs(): Promise<Partial<Record<ChainName, string>>>;
  // prices (contract per spec: data.getPrices)
  getPrices(tokenIds: string[]): Promise<PriceSnapshot[]>;
}

export interface Providers {
  data: WalletData;
  price: PriceProvider;
  broadcast: BroadcastProvider;
  waitlist: WaitlistProvider;
  bridge: BridgeProvider;
  mode: ProviderMode;
  /** True while USD figures come from the mock price provider (R1): the UI
   *  labels them as indicative mock data instead of presenting real prices. */
  pricesAreMock: boolean;
}
