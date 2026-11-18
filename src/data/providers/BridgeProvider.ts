// Real bridge provider (missing-architecture gap 5, resolution R5 option A,
// 2026-11-17): the bridge_v2 api-server under the configured frontend base
// (https://api.bridge.mintlayer.org/api/v1, F14). Quotes read GET fees and
// the agents config (the Mintlayer treasury deposit address for M2E, the
// per-token fee schedule per direction); status polls GET
// bridge-request/:uuid and maps the backend statuses onto the wallet's
// bridge states.
//
// Honest v1 scope (spec M4): the M2E route is quote+status real; INITIATION
// is gated with a typed unsupported error because completing it needs (a)
// the Mintlayer deposit intent output the current bindings facade does not
// expose and (b) a live ML submission route (R3, broadcastBase null). The
// E2M route stays disabled per R5: the wallet has no EVM signer; the scoped
// decision (same BIP39 seed, EIP-155 via audited libraries) is pending and
// is never silently dropped (the screen carries the explanatory copy).
//
// Failure policy: transport failures map to the typed BridgeError classes
// (network, failed, disabled, unsupported); raw server bodies never surface.
import { decimalsToAtoms, atomsToDecimal } from '../../money';
import { requestJson, TransportError, assertHttpsBase, type FetchLike } from '../transport';
import type { BridgeHandle, BridgeProvider, BridgeQuoteRequest, BridgeState } from './types';

export class BridgeError extends Error {
  constructor(
    readonly failure: 'network' | 'failed' | 'disabled' | 'unsupported',
    detail?: string,
  ) {
    super(detail ?? `bridge ${failure}`);
    this.name = 'BridgeError';
  }
}

export type BridgeApiConfig = {
  /** The configured bridge_v2 frontend base (endpoints.bridgeBase), already
   *  including the /api/v1 segment; null keeps the provider typed-disabled. */
  base: string | null;
  /** Overrides for the Node gate (tests). */
  fetch?: FetchLike;
  delay?: (ms: number) => Promise<void>;
};

/** bridge_v2 fee row per direction (api-server-lib fees handler). */
type BridgeFees = Record<string, { to_ml?: { fixed_fee: string; percentage_fee: string }; to_eth?: { fixed_fee: string; percentage_fee: string } }>;

/** agents-config response (CachedConfig serialization, api-server-lib). */
type AgentsConfig = {
  network_type: string;
  ml_deposit_address?: string;
  eth_flavor_specific_config?: Record<string, { m2e?: { deposit_tx_required_confirmations?: number }; bridge_contract_address?: string }>;
};

type BridgeRequestDetail = { status?: string; bridge_request_uuid?: string };

const DEFAULT_TIMEOUT_MS = 15_000;

/** Backend request statuses (records.rs BridgeRequestStatus) mapped onto
 *  the wallet bridge states; 'manual' renders as in-progress (the frontend
 *  convention: operator approval pending, not a failure). */
const STATUS_MAP: Record<string, BridgeState> = {
  pending: 'awaiting-deposit',
  processed_by_master: 'attesting',
  completed: 'minted',
  failed: 'failed',
  manual: 'attesting',
};

export function createBridgeApiProvider(cfg: BridgeApiConfig): BridgeProvider {
  if (cfg.base !== null) assertHttpsBase(cfg.base);
  const fetchImpl: FetchLike = cfg.fetch ?? (typeof fetch === 'function' ? (fetch as unknown as FetchLike) : (() => {
    throw new TransportError('transport', 'bridge', undefined);
  }));
  const delay = cfg.delay ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  async function get<T>(path: string): Promise<T> {
    if (cfg.base === null) throw new BridgeError('disabled', 'no bridge api base is configured');
    try {
      return (await requestJson({
        base: cfg.base,
        path,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        retries: 1,
        expect: 'json',
        fetchImpl,
        delay,
      })) as T;
    } catch (e) {
      throw mapTransport(e);
    }
  }

  /** Direction guard: E2M needs an EVM signer the wallet does not have
   *  (R5 open sub-question with proposal, never silently dropped). */
  function requireM2e(route: BridgeQuoteRequest['route']): void {
    if (route !== 'M2E') throw new BridgeError('unsupported', 'E2M stays disabled until the EVM signer decision lands (R5)');
  }

  async function loadConfig(): Promise<AgentsConfig> {
    return get<AgentsConfig>('/agents-config');
  }

  return {
    async quote(req) {
      requireM2e(req.route);
      const [fees, config] = await Promise.all([get<BridgeFees>('/fees'), loadConfig()]);
      const side = fees[req.token]?.to_eth;
      if (!side) throw new BridgeError('failed', `no ${req.token} fee row is configured for the ml to eth direction`);
      const fixed = safeDecimal(side.fixed_fee, 'fixed_fee');
      const pct = safePercentage(side.percentage_fee, 'percentage_fee');
      const feeAmount = fixedFeeAmount(fixed, pct, req.amount);
      const confirmations = config.eth_flavor_specific_config
        ? Object.values(config.eth_flavor_specific_config).find((flavor) => flavor.m2e?.deposit_tx_required_confirmations !== undefined)?.m2e
          ?.deposit_tx_required_confirmations
        : undefined;
      return {
        feePct: side.percentage_fee,
        feeAmount,
        // bridge_v2 documents no minimum; the screen hides the row.
        minAmount: null,
        confirmationsRequired: confirmations,
        destContractOrAddress: config.ml_deposit_address ?? '',
      };
    },

    async initiate(req) {
      requireM2e(req.route);
      // The M2E deposit is a Mintlayer transfer with an intent output
      // naming the EVM receiver. The current bindings facade exposes no
      // intent encoder, and the ML submission route is unconfigured (R3):
      // a fabricated handle would fake a bridge that never started.
      void req;
      throw new BridgeError('unsupported', 'the M2E deposit needs the intent encoder and a live ML submission route (R3)');
    },

    async status(handle: BridgeHandle): Promise<BridgeState> {
      const detail = await get<BridgeRequestDetail>(`/bridge-request/${encodeURIComponent(handle.id)}`);
      if (typeof detail.status !== 'string') throw new BridgeError('failed', 'the bridge request detail carries no status');
      const mapped = STATUS_MAP[detail.status];
      if (mapped === undefined) throw new BridgeError('failed', `unknown bridge status ${detail.status}`);
      return mapped;
    },
  };
}

function mapTransport(e: unknown): unknown {
  if (e instanceof BridgeError) return e;
  if (e instanceof TransportError) {
    if (e.kind === 'transport') return new BridgeError('network');
    if (e.kind === 'http' && e.status === 404) return new BridgeError('failed', 'bridge request not found');
    return new BridgeError('failed', undefined);
  }
  return e;
}

function safeDecimal(value: string, label: string): string {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new BridgeError('failed', `${label} is not a decimal number`);
  return value;
}

/** percentage_fee arrives normalized like "0.15%" (to_percentage_str). */
function safePercentage(value: string, label: string): string {
  const trimmed = value.endsWith('%') ? value.slice(0, -1) : value;
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) throw new BridgeError('failed', `${label} is not a percentage`);
  return trimmed;
}

/** feeAmount = fixed + amount * pct/100 on an 18-decimal BigInt scale
 *  (bridge amounts are ERC20-scale or ML atoms; no float money math). */
export function fixedFeeAmount(fixedFee: string, pct: string, amount: string): string {
  const scale = 10n ** 18n;
  const scaled = (value: string): bigint => BigInt(decimalsToAtoms(value, 18));
  const fixed = scaled(fixedFee);
  const fee = scaled(amount) * scaled(pct) / (100n * scale) + fixed;
  return atomsToDecimal(fee.toString(), 18);
}
