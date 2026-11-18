// The single registration point for data providers. Screens never construct
// providers; they consume handles through useProviders (React context).
// The mode switch reads EXPO_PUBLIC_DATA_MODE: 'mock' (default, from the
// endpoints FLAGS) or 'real'. Real mode runs the M2 chain-data layer and,
// since M3, the send pipeline: ML plan/build/sign over the bindings facade
// (device-pending until the native call-through verifies) with the
// config-gated broadcast switch, and the fully real BTC path on scure.
// Prices stay the mock provider per R1 in v1.
import type { IndexerClient } from '../ml/IndexerClient';
import type { KeySession } from '../../keys/session';
import type { ProviderMode, Providers } from './types';
import { currentNetwork, endpointsFor, FLAGS } from '../../config/endpoints';
import { openKeySession } from '../../keys/session';
import { createFixtureBridgeProvider, createFixtureBroadcastProvider, createFixtureWalletData } from '../mock/fixtures';
import { createMockHtlcFlows, createMockOrderBookService, createMockOrderFlows, createMockSwapSessionStore } from '../mock/mockTrade';
import { createMockSend } from '../mock/mockSend';
import { createConfiguredPriceProvider } from '../prices/PriceProvider';
import { createBroadcastProvider } from './BroadcastProvider';
import { createBridgeApiProvider } from './BridgeProvider';
import { createRealAccountContext } from '../real/account';
import { createRealWalletData } from '../real/realWalletData';
import { createRealSend } from '../real/realSend';
import { createFixturePriceProvider } from '../mock/priceFixtures';
import { createLocalWaitlistProvider } from '../mock/localWaitlist';
import { createOrderFlows } from '../../trade/orders';
import { createHtlcFlows } from '../../trade/htlc';
import { createSwapSessionStore } from '../../trade/swapSession';
import { createOrderBookService } from '../../trade/OrderBookService';
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
    // Lazy indexer forwarders: construction must stay offline-safe (the
    // unconfigured testnet base throws typed on first use, not at wiring).
    const indexerReader = {
      orderBook: (...args: Parameters<IndexerClient['orderBook']>) => context.requireIndexer().orderBook(...args),
      transaction: (...args: Parameters<IndexerClient['transaction']>) => context.requireIndexer().transaction(...args),
      orders: () => context.requireIndexer().orders(),
      ordersByPair: (...args: Parameters<IndexerClient['ordersByPair']>) => context.requireIndexer().ordersByPair(...args),
      order: (...args: Parameters<IndexerClient['order']>) => context.requireIndexer().order(...args),
      feerate: (...args: Parameters<IndexerClient['feerate']>) => context.requireIndexer().feerate(...args),
      spendableUtxos: (...args: Parameters<IndexerClient['spendableUtxos']>) => context.requireIndexer().spendableUtxos(...args),
      tip: () => context.requireIndexer().tip(),
    };
    const tradeAccount = async () => {
      const acct = await context.ensureAccount();
      return { manager: acct.manager, indexer: context.requireIndexer() };
    };
    const withVaultSession = async <T,>(fn: (session: KeySession) => Promise<T>): Promise<T> => {
      const session = await openKeySession();
      try {
        return await fn(session);
      } finally {
        session.release();
      }
    };
    return {
      data: createRealWalletData(context),
      send: createRealSend({
        context,
        loadBindings,
        broadcastBase: endpoints.broadcastBase,
        broadcast,
        tracker: txTracker,
        withSession: withVaultSession,
      }),
      broadcast,
      txTracker,
      waitlist: createLocalWaitlistProvider(),
      // M4 trade seams: real order book and order/HTLC flows over the
      // bindings and the indexer (device-pending honest states until the
      // native call-through verifies), the bridge_v2 api provider per R5,
      // and persisted swap sessions (preimage never persists).
      orderBook: createOrderBookService({ reader: indexerReader }),
      orders: createOrderFlows({
        network,
        loadBindings,
        indexer: indexerReader,
        broadcast,
        addresses: async () => (await tradeAccount()).manager.allAddresses('ml'),
        allocateChangeAddress: async () => (await tradeAccount()).manager.allocateChangeAddress('ml'),
        releaseFailedChange: async () => {
          await (await tradeAccount()).manager.releaseChangeAddress('ml');
        },
        withSession: withVaultSession,
      }),
      htlc: createHtlcFlows({
        network,
        loadBindings,
        indexer: indexerReader,
        broadcast,
        addresses: async () => (await tradeAccount()).manager.allAddresses('ml'),
        allocateChangeAddress: async () => (await tradeAccount()).manager.allocateChangeAddress('ml'),
        releaseFailedChange: async () => {
          await (await tradeAccount()).manager.releaseChangeAddress('ml');
        },
        withSession: withVaultSession,
      }),
      swapSessions: createSwapSessionStore(),
      bridge: createBridgeApiProvider({ base: endpoints.bridgeBase }),
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
    // Mock trade seams: demo book and demo flows over the mock broadcaster
    // (deterministic fake ids; the demo chip discloses the mode).
    orderBook: createMockOrderBookService(),
    orders: createMockOrderFlows({ broadcast, network: currentNetwork() }),
    htlc: createMockHtlcFlows({ broadcast }),
    swapSessions: createMockSwapSessionStore(),
    bridge: createFixtureBridgeProvider(),
    mode,
    ...priceProvider(),
  };
}

export type {
  ActivityRow, AssetRow, BridgeHandle, BridgeProvider, BridgeQuote,
  BridgeQuoteRequest, BridgeState, BroadcastProvider, Candle,
  CandleInterval, CardFeature, CardTier, Contact, DappsSummary, FeeSchedule, FeeTierId,
  MarketSummary, MlTxStatus, NftRow, SendQuote, SendQuoteLeg, SendResult, SendService,
  Portfolio, PricePoint, PriceProvider, PriceRange, PriceSnapshot, Profile, ProviderMode,
  Providers, TxStatusInfo, WaitlistProvider, WaitlistResult, WaitlistStatus, WalletData,
} from './types';
