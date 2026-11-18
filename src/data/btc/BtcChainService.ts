// Esplora-shaped BTC chain client (decisions.md F13): balances, UTXOs, tx
// history and fee estimates against btc-api under its /api/bitcoin base.
// The base URL is config only (endpointsFor().btcBase); when it is null no
// third-party fallback is ever hardcoded here and callers surface the
// unconfigured state instead. Shapes per the btc-api API.md, which mirrors
// the Esplora contract, so a deployment swap cannot change the client.
//
// Methods with an M3 consumer (`utxos`, `txStatus`, `tipHeight`,
// `feeEstimates`) are a recorded deferral, not an implied caller:
// decisions.md D13 lists each one with the milestone that consumes it.
//
// The retry/timeout/response-cap transport and the JSON parse guards come
// from ../transport.ts; this module owns only the Esplora parse layer and
// its error labels. It imports no error type from the ML client.
import {
  asArray, asNumberOrNull, asRecord, assertHttpsBase, MAX_ARRAY_ITEMS, requestJson,
  TransportError, type FetchLike,
} from '../transport';

export type { FetchLike } from '../transport';

export type BtcClientOptions = {
  timeoutMs?: number;
  retries?: number;
  fetch?: FetchLike;
  delay?: (ms: number) => Promise<void>;
};

export type BtcAddressStats = {
  fundedSat: string;
  spentSat: string;
  txCount: number;
};

export type BtcBalance = { confirmedSat: string; unconfirmedSat: string; totalSat: string };

export type BtcUtxo = {
  txid: string;
  vout: number;
  valueSat: string;
  confirmed: boolean;
  blockTime: number | null;
};

export type BtcTx = {
  txid: string;
  /** Null while the tx is unconfirmed (Esplora omits fee in mempool payloads
   *  served by some providers). */
  feeSat: string | null;
  confirmed: boolean;
  blockTime: number | null;
  vin: { address: string | null; valueSat: string }[];
  vout: { address: string | null; valueSat: string }[];
};

export type BtcFeeEstimates = Record<string, number>;

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;

/** Parse-guard labels carry the backend they came from. */
function btcRecord(value: unknown): Record<string, unknown> {
  return asRecord(value, 'btc response');
}

function btcArray(value: unknown, max = MAX_ARRAY_ITEMS): unknown[] {
  return asArray(value, 'btc response', max);
}

export class BtcChainService {
  private readonly base: string;

  private readonly timeoutMs: number;

  private readonly retries: number;

  private readonly fetchImpl: FetchLike;

  private readonly delay: (ms: number) => Promise<void>;

  constructor(base: string, opts?: BtcClientOptions) {
    this.base = base.replace(/\/+$/, '');
    assertHttpsBase(this.base);
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = opts?.retries ?? DEFAULT_RETRIES;
    this.delay = opts?.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    if (opts?.fetch) {
      this.fetchImpl = opts.fetch;
    } else if (typeof fetch === 'function') {
      this.fetchImpl = fetch as unknown as FetchLike;
    } else {
      throw new Error('no fetch transport available');
    }
  }

  /** GET address/:address: chain and mempool stats (tx_count drives usage probes). */
  async addressStats(address: string): Promise<{ chain: BtcAddressStats; mempool: BtcAddressStats }> {
    const raw = btcRecord(await this.request(`/address/${encodeURIComponent(address)}`));
    return { chain: parseStats(raw.chain_stats), mempool: parseStats(raw.mempool_stats) };
  }

  /** GET address/:address/balance. Esplora-shaped backends serve only
   *  {confirmed, unconfirmed}; the total is computed client-side on BigInt
   *  strings, so a missing total key is tolerated, never a parse error. */
  async balance(address: string): Promise<BtcBalance> {
    const raw = btcRecord(await this.request(`/address/${encodeURIComponent(address)}/balance`));
    const confirmedSat = asSatString(raw.confirmed);
    const unconfirmedSat = asSatString(raw.unconfirmed);
    const totalSat = (BigInt(confirmedSat) + BigInt(unconfirmedSat)).toString();
    return { confirmedSat, unconfirmedSat, totalSat };
  }

  /** GET address/:address/utxo. */
  async utxos(address: string): Promise<BtcUtxo[]> {
    return btcArray(await this.request(`/address/${encodeURIComponent(address)}/utxo`)).map((raw) => {
      const record = btcRecord(raw);
      const status = record.status === null || record.status === undefined ? {} : btcRecord(record.status);
      return {
        txid: asId(record.txid),
        vout: asNumber(record.vout),
        valueSat: asSatString(record.value),
        confirmed: status.confirmed === true,
        blockTime: asNumberOrNull(status.block_time),
      };
    });
  }

  /** GET address/:address/txs (confirmed) and /txs/mempool. */
  async txs(address: string, opts?: { mempool?: boolean; after?: string }): Promise<BtcTx[]> {
    const suffix = opts?.mempool ? 'txs/mempool' : 'txs';
    const query: Record<string, string> = {};
    if (opts?.after !== undefined) query.after = opts.after;
    return btcArray(await this.request(`/address/${encodeURIComponent(address)}/${suffix}`, query)).map(parseTx);
  }

  /** GET tx/:txid/status. */
  async txStatus(txid: string): Promise<{ confirmed: boolean; blockTime: number | null }> {
    const raw = btcRecord(await this.request(`/tx/${encodeURIComponent(txid)}/status`));
    return { confirmed: raw.confirmed === true, blockTime: asNumberOrNull(raw.block_time) };
  }

  /** GET blocks/tip/height. */
  async tipHeight(): Promise<number> {
    const raw = await this.request('/blocks/tip/height');
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(raw);
    throw new TransportError('parse', '/blocks/tip/height', undefined);
  }

  /** GET fee-estimates: sat/vbyte keyed by confirmation target. */
  async feeEstimates(): Promise<BtcFeeEstimates> {
    const raw = btcRecord(await this.request('/fee-estimates'));
    const out: BtcFeeEstimates = {};
    for (const [target, rate] of Object.entries(raw)) {
      if (typeof rate === 'number' && Number.isFinite(rate)) out[target] = rate;
    }
    return out;
  }

  /** One request with timeout, typed errors and 429/5xx retry with backoff;
   *  the shared transport owns the loop (no Retry-After hook: this backend
   *  does not honor the header). */
  private async request(path: string, query?: Record<string, string>): Promise<unknown> {
    return requestJson({
      base: this.base,
      path,
      query,
      timeoutMs: this.timeoutMs,
      retries: this.retries,
      fetchImpl: this.fetchImpl,
      delay: this.delay,
    });
  }
}

function parseStats(raw: unknown): BtcAddressStats {
  const record = btcRecord(raw);
  return {
    fundedSat: asSatString(record.funded_txo_sum),
    spentSat: asSatString(record.spent_txo_sum),
    txCount: asNumber(record.tx_count),
  };
}

function parseTx(raw: unknown): BtcTx {
  const record = btcRecord(raw);
  const status = record.status === null || record.status === undefined ? {} : btcRecord(record.status);
  return {
    txid: asId(record.txid),
    feeSat: record.fee === undefined || record.fee === null ? null : asSatString(record.fee),
    confirmed: status.confirmed === true,
    blockTime: asNumberOrNull(status.block_time),
    vin: btcArray(record.vin ?? []).map((entry) => {
      const vinRecord = btcRecord(entry);
      const prevout = vinRecord.prevout === null || vinRecord.prevout === undefined ? {} : btcRecord(vinRecord.prevout);
      return {
        address: typeof prevout.scriptpubkey_address === 'string' ? prevout.scriptpubkey_address : null,
        valueSat: asSatString(prevout.value),
      };
    }),
    vout: btcArray(record.vout ?? []).map((entry) => {
      const voutRecord = btcRecord(entry);
      return {
        address: typeof voutRecord.scriptpubkey_address === 'string' ? voutRecord.scriptpubkey_address : null,
        valueSat: asSatString(voutRecord.value),
      };
    }),
  };
}

function asId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new TransportError('parse', 'btc txid', undefined);
  return value;
}

function asNumber(value: unknown): number {
  const parsed = asNumberOrNull(value);
  if (parsed === null) throw new TransportError('parse', 'btc number', undefined);
  return parsed;
}

/** Satoshis arrive as numbers or numeric strings; always stringified so no
 *  float math ever touches amounts. Numbers must be integers: a fractional
 *  value is a backend contract violation and would make the downstream
 *  BigInt() throw untyped. Negative integers stay legal (unconfirmed). */
function asSatString(value: unknown): string {
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  throw new TransportError('parse', 'btc amount', undefined);
}
