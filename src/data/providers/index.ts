// The single registration point for data providers. Screens never construct
// providers; they consume handles through useProviders (React context).
// The mode switch reads EXPO_PUBLIC_DATA_MODE: 'mock' (default) or 'real'.
// 'real' throws in M0 so nothing silently pretends to work.
import type { ProviderMode, Providers } from './types';
import { createFixtureBridgeProvider, createFixtureBroadcastProvider, createFixtureWalletData } from '../mock/fixtures';
import { createFixturePriceProvider } from '../mock/priceFixtures';
import { createLocalWaitlistProvider } from '../mock/localWaitlist';

export function readDataMode(): ProviderMode {
  return process.env.EXPO_PUBLIC_DATA_MODE === 'real' ? 'real' : 'mock';
}

export function createProviders(mode: ProviderMode = readDataMode()): Providers {
  if (mode === 'real') {
    throw new Error('not-implemented: real providers arrive in M2');
  }
  return {
    data: createFixtureWalletData(),
    price: createFixturePriceProvider(),
    broadcast: createFixtureBroadcastProvider(),
    waitlist: createLocalWaitlistProvider(),
    bridge: createFixtureBridgeProvider(),
    mode,
  };
}

export type {
  ActivityRow, AssetRow, BookLevel, BridgeChain, BridgeHandle, BridgeProvider, BridgeQuote,
  BridgeQuoteLine, BridgeQuoteRequest, BridgeRouteStep, BridgeState, BroadcastProvider, Candle,
  CardFeature, CardTier, Contact, FeeSchedule, FeeTierId, HtlcStep, MarketSummary, MlTxStatus,
  Portfolio, PricePoint, PriceProvider, PriceRange, PriceSnapshot, Profile, ProviderMode,
  Providers, SwapStat, WaitlistProvider, WaitlistResult, WaitlistStatus, WalletData,
} from './types';
