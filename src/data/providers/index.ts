// The single registration point for data providers. Screens never construct
// providers; they consume handles through useProviders (React context).
// The mode switch reads EXPO_PUBLIC_DATA_MODE: 'mock' (default, from the
// endpoints FLAGS) or 'real'. 'real' throws in M0 so nothing silently
// pretends to work.
import type { ProviderMode, Providers } from './types';
import { currentNetwork, endpointsFor, FLAGS } from '../../config/endpoints';
import { openKeySession } from '../../keys/session';
import { createFixtureBridgeProvider, createFixtureBroadcastProvider, createFixtureWalletData } from '../mock/fixtures';
import { createConfiguredPriceProvider } from '../prices/PriceProvider';
import { createRealWalletData } from '../real/realWalletData';
import { createFixturePriceProvider } from '../mock/priceFixtures';
import { createLocalWaitlistProvider } from '../mock/localWaitlist';

export function readDataMode(): ProviderMode {
  return process.env.EXPO_PUBLIC_DATA_MODE === 'real' ? 'real' : FLAGS.defaultDataMode;
}

/**
 * Prices per R1: v1 runs the mock provider in both modes; a configured
 * priceBase activates the real provider stub, which fails with the typed
 * not-configured error until the self-hosted backend lands.
 */
function priceProvider(): Pick<Providers, 'price' | 'pricesAreMock'> {
  const base = endpointsFor().priceBase;
  if (!base) return { price: createFixturePriceProvider(), pricesAreMock: true };
  return { price: createConfiguredPriceProvider(base), pricesAreMock: false };
}

export function createProviders(mode: ProviderMode = readDataMode()): Providers {
  if (mode === 'real') {
    const network = currentNetwork();
    const endpoints = endpointsFor(network);
    return {
      data: createRealWalletData({
        network,
        indexerBase: endpoints.indexerBase,
        btcBase: endpoints.btcBase,
        deriveXpubs: async () => {
          const session = await openKeySession();
          try {
            return { mlXpub: await session.xpubMl(network), btcXpub: await session.xpubBtc(network) };
          } finally {
            session.release();
          }
        },
      }),
      broadcast: createFixtureBroadcastProvider(),
      waitlist: createLocalWaitlistProvider(),
      bridge: createFixtureBridgeProvider(),
      mode,
      ...priceProvider(),
    };
  }
  return {
    data: createFixtureWalletData(),
    broadcast: createFixtureBroadcastProvider(),
    waitlist: createLocalWaitlistProvider(),
    bridge: createFixtureBridgeProvider(),
    mode,
    ...priceProvider(),
  };
}

export type {
  ActivityRow, AssetRow, BookLevel, BridgeChain, BridgeHandle, BridgeProvider, BridgeQuote,
  BridgeQuoteLine, BridgeQuoteRequest, BridgeRouteStep, BridgeState, BroadcastProvider, Candle,
  CandleInterval, CardFeature, CardTier, Contact, DappsSummary, FeeSchedule, FeeTierId, HtlcStep,
  MarketSummary, MlTxStatus, NftRow,
  Portfolio, PricePoint, PriceProvider, PriceRange, PriceSnapshot, Profile, ProviderMode,
  Providers, SwapStat, WaitlistProvider, WaitlistResult, WaitlistStatus, WalletData,
} from './types';
