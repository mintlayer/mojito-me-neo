// Broadcast dispatch (missing-architecture gap 3, resolution R3). The mock
// broadcaster is the v1 demo path so the whole send flow is demoable; the
// real ML submission route is config-gated behind endpoints.broadcastBase
// and activates with a URL change only (action item A1: the Mintlayer
// operated production API returns 403 on POST /transaction, F7). BTC
// broadcast is unaffected by the gap: btc-api POST tx exists (F13) and
// rides the configured btc-api base.
//
// Failure policy: everything maps to BroadcastError with a failure class
// the screen can copy honestly (disabled = this network cannot broadcast,
// failed = the backend refused or answered unusable data, network = the
// request never completed). Raw server bodies never surface.
import { assertHttpsBase, assertTxHex, requestJson, TransportError, type FetchLike } from '../transport';
import { IndexerClient } from '../ml/IndexerClient';
import { BtcChainService } from '../btc/BtcChainService';
import { createFixtureBroadcastProvider } from '../mock/fixtures';
import type { BroadcastProvider, ProviderMode, TxStatusInfo } from './types';

export type BroadcastChain = 'ml' | 'btc';

export type BroadcastFailure = 'disabled' | 'failed' | 'network';

/** Typed broadcast failure of one chain. */
export class BroadcastError extends Error {
  constructor(
    readonly chain: BroadcastChain,
    readonly failure: BroadcastFailure,
    readonly status?: number,
    readonly detail?: string,
  ) {
    super(detail ?? `broadcast ${failure} on ${chain}`);
    this.name = 'BroadcastError';
  }
}

export type BroadcastProviderConfig = {
  mode: ProviderMode;
  /** ML submission base (endpoints.broadcastBase, the R3 switch). */
  broadcastBase: string | null;
  indexerBase: string | null;
  btcBase: string | null;
  /** Overrides for the Node gate (tests). */
  fetch?: FetchLike;
  delay?: (ms: number) => Promise<void>;
};

const HEX64 = /^[0-9a-f]{64}$/;

function guardHex(chain: BroadcastChain, signedTxHex: string): void {
  // The shared tx-hex contract (transport.ts); this boundary maps the
  // failure to its own typed broadcast error.
  try {
    assertTxHex(signedTxHex, 'broadcast');
  } catch {
    throw new BroadcastError(chain, 'failed', undefined, 'signed transaction hex is malformed');
  }
}

/**
 * Real-mode provider: real routes where the network config allows them,
 * typed disabled errors where it does not. Mock mode keeps the fixture
 * provider (src/data/mock/fixtures.ts): a fake id after a delay, pending
 * status, so the flow stays demoable without pretending to be real.
 */
export function createBroadcastProvider(cfg: BroadcastProviderConfig): BroadcastProvider {
  if (cfg.mode === 'mock') {
    return createFixtureBroadcastProvider();
  }
  if (cfg.broadcastBase !== null) assertHttpsBase(cfg.broadcastBase);
  const indexer = cfg.indexerBase !== null ? new IndexerClient(cfg.indexerBase, { fetch: cfg.fetch, delay: cfg.delay }) : null;
  const btc = cfg.btcBase !== null ? new BtcChainService(cfg.btcBase, { fetch: cfg.fetch, delay: cfg.delay }) : null;

  const broadcastMl = async (signedTxHex: string): Promise<{ txId: string }> => {
    guardHex('ml', signedTxHex);
    if (cfg.broadcastBase === null) {
      throw new BroadcastError('ml', 'disabled', undefined, 'no ML submission endpoint is configured');
    }
    try {
      const raw = await requestJson({
        base: cfg.broadcastBase,
        path: '/transaction',
        method: 'POST',
        body: signedTxHex,
        contentType: 'application/octet-stream',
        expect: 'json',
        timeoutMs: 15_000,
        retries: 1,
        fetchImpl: cfg.fetch ?? globalFetch,
        delay: cfg.delay ?? defaultDelay,
      });
      const txId = typeof raw === 'string' ? raw : '';
      if (!HEX64.test(txId)) throw new BroadcastError('ml', 'failed', undefined, 'submission answered without a tx id');
      return { txId };
    } catch (e) {
      throw mapTransport('ml', e);
    }
  };

  const broadcastBtc = async (signedTxHex: string): Promise<{ txId: string }> => {
    guardHex('btc', signedTxHex);
    if (btc === null) {
      throw new BroadcastError('btc', 'disabled', undefined, 'no btc-api base is configured');
    }
    try {
      return { txId: await btc.broadcastTx(signedTxHex) };
    } catch (e) {
      throw mapTransport('btc', e);
    }
  };

  const getMlStatus = async (txId: string): Promise<TxStatusInfo> => {
    if (indexer === null) return { state: 'pending' as const };
    try {
      const tx = await indexer.transaction(txId);
      if (tx.blockId !== null) return { state: 'confirmed' as const, blockId: tx.blockId, confirmations: tx.confirmations ?? undefined };
      return { state: 'pending' as const };
    } catch (e) {
      if (e instanceof TransportError && e.kind === 'http' && e.status === 404) return { state: 'not-found' as const };
      throw e;
    }
  };

  const getBtcStatus = async (txId: string): Promise<TxStatusInfo> => {
    if (btc === null) return { state: 'pending' as const };
    const status = await btc.txStatus(txId);
    if (!status.confirmed) return { state: 'pending' as const };
    // Confirmation count against the chain tip (Esplora block_height is the
    // 1-based inclusion height). A tip read failure keeps the count-less
    // confirmed answer: an unknown count must not render as zero.
    if (status.blockHeight === null) return { state: 'confirmed' as const };
    try {
      const confirmations = Math.max(1, (await btc.tipHeight()) - status.blockHeight + 1);
      return { state: 'confirmed' as const, confirmations };
    } catch {
      return { state: 'confirmed' as const };
    }
  };

  return { broadcastMl, broadcastBtc, getMlStatus, getBtcStatus };
}

/** Map a chain-client failure to the typed broadcast failure classes. */
function mapTransport(chain: BroadcastChain, e: unknown): BroadcastError | unknown {
  if (e instanceof BroadcastError) return e;
  if (e instanceof TransportError) {
    if (e.kind === 'http' && e.status === 403) return new BroadcastError(chain, 'disabled', 403, 'the submission route is not enabled on this backend');
    if (e.kind === 'transport') return new BroadcastError(chain, 'network', undefined, undefined);
    return new BroadcastError(chain, 'failed', e.status, undefined);
  }
  return e;
}

const globalFetch: FetchLike = typeof fetch === 'function' ? (fetch as unknown as FetchLike) : (() => {
  throw new TransportError('transport', 'broadcast', undefined);
});

const defaultDelay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
