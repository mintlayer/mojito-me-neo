// Fixture-backed provider implementations for M0. src/data.ts stays the
// fixture source of truth; everything here re-exports through it and returns
// the exact shapes the screens render today. No network calls land in M0.
import {
  ACTIVITY,
  ADDRESSES,
  ASKS,
  ASSETS,
  ASSET_BALANCES,
  ASSET_SYMBOLS,
  BALANCE,
  BIDS,
  BRIDGE_CHAINS,
  BRIDGE_QUOTE,
  BRIDGE_ROUTE,
  CARD_FEATURES,
  CARD_TIERS,
  CHAIN_GLYPH,
  CONTACTS,
  DAPPS,
  FEES,
  HTLC_STEPS,
  MARKET,
  NETWORKS,
  PROFILE,
  RANGES,
  SWAP_STATS,
  TIMEFRAMES,
  WAITLIST,
} from '../../data';
import type {
  BridgeHandle,
  BridgeProvider,
  BridgeQuote,
  BridgeQuoteRequest,
  BridgeState,
  BroadcastProvider,
  MlTxStatus,
  WalletData,
} from '../providers/types';
import { createFixturePriceProvider } from './priceFixtures';

export function createFixtureWalletData(): WalletData {
  const price = createFixturePriceProvider();
  return {
    getPortfolio: async () => BALANCE,
    getAssets: async () => ASSETS,
    getAssetSymbols: async () => ASSET_SYMBOLS,
    getAssetBalances: async () => ASSET_BALANCES,
    getActivity: async (limit) => ACTIVITY.slice(0, limit),
    getNetworks: async () => [...NETWORKS],
    getRanges: async () => [...RANGES],
    getProfile: async () => PROFILE,
    getMarket: async () => MARKET,
    getOrderBook: async () => ({ asks: [...ASKS], bids: [...BIDS] }),
    getTimeframes: async () => [...TIMEFRAMES],
    getHtlcSteps: async () => [...HTLC_STEPS],
    getSwapStats: async () => SWAP_STATS,
    getBridgeChains: async () => [...BRIDGE_CHAINS],
    getBridgeRoute: async () => [...BRIDGE_ROUTE],
    getBridgeQuote: async () => BRIDGE_QUOTE,
    getWaitlist: async () => WAITLIST,
    getDapps: async () => DAPPS,
    getCardFeatures: async () => [...CARD_FEATURES],
    getCardTiers: async () => [...CARD_TIERS],
    getFees: async () => FEES,
    getContacts: async () => [...CONTACTS],
    getAddresses: async () => ADDRESSES,
    getChainGlyphs: async () => CHAIN_GLYPH,
    getPrices: (tokenIds) => price.getSnapshots(tokenIds),
  };
}

/** Mock broadcast (R3 option D): a deterministic fake tx id after a delay. */
export function createFixtureBroadcastProvider(): BroadcastProvider {
  const broadcastMl = async (signedTxHex: string): Promise<{ txId: string }> => {
    if (!/^[0-9a-f]+$/i.test(signedTxHex) || signedTxHex.length === 0) {
      throw new Error('invalid signed transaction hex');
    }
    await delay(400);
    return { txId: fakeTxId(signedTxHex) };
  };
  const getMlStatus = async (_txId: string): Promise<MlTxStatus> => {
    await delay(200);
    return 'pending';
  };
  return { broadcastMl, getMlStatus };
}

/** Simulated bridge walk (missing-architecture gap 5): quotes from fixtures. */
export function createFixtureBridgeProvider(): BridgeProvider {
  const quote = async (_req: BridgeQuoteRequest): Promise<BridgeQuote> => ({
    feePct: '0.15',
    feeAmount: '0.75',
    minAmount: '10.00',
    etaSeconds: 65,
    destContractOrAddress: '0xA1c2…F39e',
  });
  const initiate = async (req: BridgeQuoteRequest): Promise<BridgeHandle> => {
    await delay(300);
    return { id: fakeTxId(`${req.route}:${req.amount}:${req.destAddr}`), createdAt: Date.now() };
  };
  const status = async (handle: BridgeHandle): Promise<BridgeState> => {
    const elapsed = (Date.now() - handle.createdAt) / 1000;
    if (elapsed < 15) return 'awaiting-deposit';
    if (elapsed < 60) return 'attesting';
    return 'minted';
  };
  return { quote, initiate, status };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakeTxId(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = (Math.imul(h1 ^ c, 0x01000193) + i) >>> 0;
    h2 = (Math.imul(h2 + c, 0x85ebca6b) ^ (h1 >>> 7)) >>> 0;
  }
  let hexOut = '';
  for (let round = 0; round < 8; round++) {
    h1 = (Math.imul(h1 ^ h2, 0x9e3779b9) + round) >>> 0;
    h2 = (Math.imul(h2 ^ h1, 0xc2b2ae35) + round) >>> 0;
    hexOut += h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  }
  return hexOut.slice(0, 64);
}
