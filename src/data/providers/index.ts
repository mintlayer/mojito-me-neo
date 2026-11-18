// The single registration point for data providers. Screens never construct
// providers; they consume handles through useProviders (React context).
// The mode switch reads EXPO_PUBLIC_DATA_MODE: 'mock' (default, from the
// endpoints FLAGS) or 'real'. Real mode runs the M2 chain-data layer and,
// since M3, the send pipeline: ML plan/build/sign over the bindings facade
// (device-pending until the native call-through verifies) with the
// config-gated broadcast switch, and the fully real BTC path on scure.
// Prices stay the mock provider per R1 in v1.
import type { ProviderMode, Providers } from './types';
import { currentNetwork, endpointsFor, FLAGS } from '../../config/endpoints';
import { openKeySession } from '../../keys/session';
import { createFixtureBridgeProvider, createFixtureBroadcastProvider, createFixtureWalletData } from '../mock/fixtures';
import { createMockSend } from '../mock/mockSend';
import { createConfiguredPriceProvider } from '../prices/PriceProvider';
import { createBroadcastProvider } from './BroadcastProvider';
import { createRealAccountContext } from '../real/account';
import { createRealWalletData } from '../real/realWalletData';
import { createRealSend } from '../real/realSend';
import { createFixturePriceProvider } from '../mock/priceFixtures';
import { createLocalWaitlistProvider } from '../mock/localWaitlist';
import { TxTracker } from '../../send/TxTracker';

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

type MojitoCoreModule = typeof import('../../../modules/mojito-core');

/** The bindings facade pulls expo-modules-core (and with it react-native),
 *  which cannot load under the Node gate; mock mode never touches it, so
 *  the require stays lazy inside the real branch (polling.ts precedent). */
function loadBindings(): MojitoCoreModule['MojitoCore'] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const core = require('../../../modules/mojito-core') as MojitoCoreModule;
  return core.MojitoCore;
}

export function createProviders(mode: ProviderMode = readDataMode()): Providers {
  if (mode === 'real') {
    const network = currentNetwork();
    const endpoints = endpointsFor(network);
    const context = createRealAccountContext({
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
    });
    const broadcast = createBroadcastProvider({
      mode,
      broadcastBase: endpoints.broadcastBase,
      indexerBase: endpoints.indexerBase,
      btcBase: endpoints.btcBase,
    });
    const txTracker = new TxTracker(broadcast);
    return {
      data: createRealWalletData(context),
      send: createRealSend({
        context,
        loadBindings,
        broadcastBase: endpoints.broadcastBase,
        broadcast,
        tracker: txTracker,
        withSession: async (fn) => {
          const session = await openKeySession();
          try {
            return await fn(session);
          } finally {
            session.release();
          }
        },
      }),
      broadcast,
      txTracker,
      waitlist: createLocalWaitlistProvider(),
      bridge: createFixtureBridgeProvider(),
      mode,
      ...priceProvider(),
    };
  }
  const broadcast = createFixtureBroadcastProvider();
  return {
    data: createFixtureWalletData(),
    send: createMockSend({ broadcast, network: currentNetwork() }),
    broadcast,
    txTracker: new TxTracker(broadcast),
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
  MarketSummary, MlTxStatus, NftRow, SendQuote, SendQuoteLeg, SendResult, SendService,
  Portfolio, PricePoint, PriceProvider, PriceRange, PriceSnapshot, Profile, ProviderMode,
  Providers, SwapStat, TxStatusInfo, WaitlistProvider, WaitlistResult, WaitlistStatus, WalletData,
} from './types';
