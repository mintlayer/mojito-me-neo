// Single source for the data-provider seams. Every later milestone implements
// against these interfaces; the mock | real mode switch lives in
// src/data/providers/index.ts. Shapes mirror the gap interfaces in
// missing-architecture.md so the real implementations slot in unchanged.
import type { ChainName, Tone } from '../../theme';
import type { IconName } from '../../ui/icons';
import type { TxTracker } from '../../send/TxTracker';
import type { OrderBookService } from '../../trade/OrderBookService';
import type { OrderFlows } from '../../trade/orders';
import type { HtlcFlows } from '../../trade/htlc';
import type { SwapSessionStore } from '../../trade/swapSession';

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
  /** Send precision (M3): exact decimals for the amount parser; absent in
   *  fixture rows, where the screen falls back to the chain default. */
  decimals?: number;
  /** On-chain token id for MLS-01 sends; absent for coin rows. */
  tokenId?: string;
  /** Exact decimal string of the unconfirmed balance included in `amt`
   *  (BTC row): the send path refuses unconfirmed external receipts, so
   *  the row discloses the pending share instead of presenting the whole
   *  amount as spendable. */
  pending?: string;
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

// Card
export type WaitlistStatus = { taken: number; total: number };
export type DappsSummary = { active: number };
export type CardFeature = { icon: IconName; title: string; detail: string; tone: Tone };
export type CardTier = { name: string; stake: string; cashback: string; active?: boolean };

// Send and receive
export type FeeTierId = 'economy' | 'standard' | 'fast';
export type FeeSchedule = Record<FeeTierId, { cost: number }>;
export type Contact = { name: string; address: string };

/** One per-tier fee quote for the send screen (spec M3: live estimates;
 *  ML quotes carry atoms/kB, BTC quotes sat/vB; the fallback flag marks a
 *  fixed rate used because the estimates backend is unreachable). */
export type SendQuoteLeg = {
  feeDecimal: string;
  feeAtoms: string;
  /** ML: transaction size in bytes; BTC: vsize. */
  sizeBytes: number;
  rateAtomsPerKb?: string;
  satPerVbyte?: string;
  rateIsFallback?: boolean;
  changeAtoms?: string;
};

export type SendQuote = Record<FeeTierId, SendQuoteLeg>;

export type SendResult = {
  txId: string;
  kind: 'ml' | 'btc';
  /** True when the id comes from the mock broadcaster (R3 demo path). */
  demo: boolean;
  /** True when the broadcast succeeded but post-send bookkeeping (activity
   *  tracking or fresh-address rotation) failed locally: the transaction is
   *  on the network, so this must never read as a failed send. */
  warning?: boolean;
};

/** The send seam screens consume (real in real mode, mock demo otherwise). */
export interface SendService {
  canBroadcast(chain: 'ml' | 'btc'): boolean;
  quoteMl(params: { to: string; amountDecimal: string; decimals: number; tokenId?: string }): Promise<SendQuote>;
  sendMl(params: { to: string; amountDecimal: string; decimals: number; tier: FeeTierId; tokenId?: string }): Promise<SendResult>;
  quoteBtc(params: { to: string; amountDecimal: string }): Promise<SendQuote>;
  /** satPerVbyte pins the reviewed rate: the send re-checks the live
   *  estimate and refuses typed when it rose past what the user reviewed,
   *  so the signed fee is the reviewed fee (or the send fails safe). */
  sendBtc(params: { to: string; amountDecimal: string; tier: FeeTierId; satPerVbyte?: string; rateIsFallback?: boolean }): Promise<SendResult>;
}

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

// Broadcast (missing-architecture gap 3, R3: mock is the v1 demo path;
// the real ML route stays config-gated behind broadcastBase, BTC rides the
// configured btc-api POST tx which exists per F13)
export type MlTxStatus = 'pending' | 'confirmed' | 'not-found';

export type TxStatusInfo = {
  state: MlTxStatus;
  /** Mintlayer block id once confirmed; absent while pending. */
  blockId?: string;
  confirmations?: number;
};

export interface BroadcastProvider {
  broadcastMl(signedTxHex: string): Promise<{ txId: string }>;
  broadcastBtc(signedTxHex: string): Promise<{ txId: string }>;
  getMlStatus(txId: string): Promise<TxStatusInfo>;
  getBtcStatus(txId: string): Promise<TxStatusInfo>;
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
  feePct: string;
  feeAmount: string;
  /** Documented minimum (fixture); the bridge_v2 API documents none, so the
   *  real provider answers null and the screen hides the row. */
  minAmount?: string | null;
  /** Documented seconds ETA (fixture); the real API reports confirmations
   *  instead, so this is absent on real quotes. */
  etaSeconds?: number;
  /** Real API: the m2e deposit confirmations the master waits for. */
  confirmationsRequired?: number;
  /** M2E: the Mintlayer treasury deposit address to fund (F14). */
  destContractOrAddress: string;
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
  // dex. Null answers a price-snapshot miss: the header renders a typed
  // unavailable state, never a fixture row (the AssetRow.unavailable
  // precedent).
  getMarket(pair: string): Promise<MarketSummary | null>;
  getTimeframes(): Promise<CandleInterval[]>;
  /** Token ids served for one ticker; tickers are not unique (F6), so the
   *  list can carry more than one id and callers must disambiguate
   *  honestly instead of guessing (M4 order placement). */
  getTokenIds(ticker: string): Promise<string[]>;
  /** Ticker and decimals of one token id; null when unindexed. */
  getTokenMeta(tokenId: string): Promise<{ ticker: string | null; decimals: number } | null>;
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
  send: SendService;
  txTracker: TxTracker;
  waitlist: WaitlistProvider;
  bridge: BridgeProvider;
  mode: ProviderMode;
  /** True while USD figures come from the mock price provider (R1): the UI
   *  labels them as indicative mock data instead of presenting real prices. */
  pricesAreMock: boolean;

  // Trade seams (spec M4): real in real mode over the bindings and the
  // indexer, demo-labelled in mock mode (createMockSend pattern), so the
  // screens stay mode-agnostic and the demo chip stays honest.
  /** Live order book (DexScreen depth rows); the fixture book in mock. */
  orderBook: OrderBookService;
  /** On-chain order flows (place, fill, conclude); demo pipeline in mock. */
  orders: OrderFlows;
  /** ML-side HTLC swap flows; demo pipeline in mock. */
  htlc: HtlcFlows;
  /** Persisted swap sessions (restart-survivable). */
  swapSessions: SwapSessionStore;
}
