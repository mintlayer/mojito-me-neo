// Typed REST client for the public Mintlayer indexer under /api/v2
// (decisions.md F6, endpoint verdicts in api-coverage.md). Read-only and
// unauthenticated: no secrets ride in query strings, and address scanning
// stays sequential one-request-per-address (see BalanceService).
//
// Failure policy: network failures, timeouts and non-JSON bodies map to
// typed IndexerError values (transport, http, parse); raw server bodies
// never surface to the UI. 429 and 5xx responses retry with backoff,
// honoring a capped Retry-After header when present. Every request carries
// an AbortController timeout. Transport is injectable so the whole client
// is testable offline against fixture responses.
import type {
  AmountJson, CoinStats, MlAddressInfo, MlNftInfo, MlOutput, MlOutpoint, MlTokenInfo,
  MlTransaction, MlTransactionInput, MlUtxo, OrderBookLevel, OrderBookPage,
} from './types';

export type FetchLike = (url: string, init: { signal: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text: () => Promise<string>;
}>;

export type IndexerErrorKind = 'http' | 'transport' | 'parse';

export class IndexerError extends Error {
  /** Milliseconds from a Retry-After header, capped; read by the retry loop. */
  retryAfterMs?: number;

  constructor(
    readonly kind: IndexerErrorKind,
    readonly endpoint: string,
    readonly status?: number,
  ) {
    super(`indexer ${kind} error on ${endpoint}${status !== undefined ? ` (http ${status})` : ''}`);
    this.name = 'IndexerError';
  }
}

export type IndexerClientOptions = {
  /** Per-request abort timeout; 15s covers the slow aggregate endpoints. */
  timeoutMs?: number;
  /** Retry attempts for 429 and 5xx responses and transport errors. */
  retries?: number;
  /** Injected transport for offline tests. */
  fetch?: FetchLike;
  /** Injected delay for deterministic backoff tests. */
  delay?: (ms: number) => Promise<void>;
};

export type Tip = { blockHeight: number; blockId: string };

export type OrderBookSide = 'ask' | 'bid';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 8_000;
/** Ceiling for a server-provided Retry-After so a hostile header cannot pin the wallet. */
const RETRY_AFTER_CAP_MS = 30_000;

/** Cap on one response body before JSON.parse: a hostile endpoint must not
 *  read a multi-GB body into memory. 4 MiB is far above any documented
 *  endpoint payload; shared with the BTC client so both transports agree. */
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/** Cap on one parsed array (transactions, tokens, utxos): bounds the work
 *  a single hostile response can force. */
export const MAX_ARRAY_ITEMS = 5_000;

/** Config guard: chain bases are https; plaintext is allowed only for the
 *  documented localhost dev fallbacks, so a config regression fails fast
 *  at construction instead of shipping plaintext traffic. */
export function assertHttpsBase(base: string): void {
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    throw new Error(`invalid base URL: ${base}`);
  }
  if (parsed.protocol === 'https:') return;
  if (parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname)) return;
  throw new Error(`base must use https (http only for localhost dev): ${base}`);
}
/** Walker bounds: a non-terminating listing is a parse error, not a loop. */
export type WalkerCaps = { maxPages?: number; maxItems?: number };

const DEFAULT_MAX_PAGES = 100;

const DEFAULT_MAX_ITEMS = 50_000;

function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
}

/** Absorb every documented amount shape into the atoms/decimal pair.
 *  Numbers must be safe integers (Uint64 atom counts upstream); a 1e21
 *  scale number would stringify into e-notation and explode downstream.
 *  An object without atoms or decimal is a typed parse error, never a
 *  silent zero. */
export function parseAmount(raw: unknown): AmountJson {
  if (typeof raw === 'string') {
    return /^\d+$/.test(raw) ? { atoms: raw } : { decimal: raw };
  }
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw) || raw < 0) throw new IndexerError('parse', 'amount', undefined);
    return { atoms: String(raw) };
  }
  if (raw !== null && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    const out: AmountJson = {};
    if (record.atoms !== undefined) {
      if (typeof record.atoms === 'number') {
        if (!Number.isSafeInteger(record.atoms) || record.atoms < 0) throw new IndexerError('parse', 'amount', undefined);
        out.atoms = String(record.atoms);
      } else if (typeof record.atoms === 'string') {
        out.atoms = record.atoms;
      } else {
        throw new IndexerError('parse', 'amount', undefined);
      }
    }
    if (typeof record.decimal === 'string') out.decimal = record.decimal;
    if (out.atoms === undefined && out.decimal === undefined) throw new IndexerError('parse', 'amount', undefined);
    return out;
  }
  throw new IndexerError('parse', 'amount', undefined);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** One level of JSON string quoting stripped: upstream double-encodes
 *  display strings (tickers, NFT names), so '"USDT"' must surface as
 *  'USDT'. Values that are not quoted strings pass through unchanged. */
function unquoted(value: unknown): string | null {
  const raw = asString(value);
  if (raw === null || raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return raw;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'string' ? parsed : raw;
  } catch {
    return raw;
  }
}

function asNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length > 0 && /^\d+$/.test(value)) return Number(value);
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new IndexerError('parse', 'response', undefined);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, max = MAX_ARRAY_ITEMS): unknown[] {
  if (!Array.isArray(value)) throw new IndexerError('parse', 'response', undefined);
  if (value.length > max) throw new IndexerError('parse', 'response', undefined);
  return value;
}

function parseOutpoint(raw: unknown): MlOutpoint {
  const record = asRecord(raw);
  const sourceId = asString(record.source_id);
  const index = asNumberOrNull(record.index);
  const sourceType = asString(record.source_type);
  if (sourceId === null || index === null || sourceType === null) {
    throw new IndexerError('parse', 'utxo outpoint', undefined);
  }
  return { sourceType, sourceId, index };
}

function parseOutput(raw: unknown): MlOutput {
  const record = asRecord(raw);
  const type = asString(record.type) ?? '';
  const valueRecord = record.value !== undefined && record.value !== null ? asRecord(record.value) : undefined;
  const tokenId = asString(record.token_id) ?? (valueRecord ? asString(valueRecord.token_id) : null) ?? undefined;
  return {
    type,
    destination: asString(record.destination) ?? undefined,
    value: valueRecord
      ? {
          type: asString(valueRecord.type) ?? '',
          tokenId: tokenId,
          amount: valueRecord.amount !== undefined ? parseAmount(valueRecord.amount) : undefined,
        }
      : undefined,
    tokenId: type === 'IssueNft' ? tokenId : undefined,
  };
}

function parseUtxo(raw: unknown): MlUtxo {
  const record = asRecord(raw);
  return { outpoint: parseOutpoint(record.outpoint), output: parseOutput(record.utxo) };
}

function parseTransaction(raw: unknown): MlTransaction {
  const record = asRecord(raw);
  const id = asString(record.id);
  if (id === null) throw new IndexerError('parse', 'transaction', undefined);
  const inputs: MlTransactionInput[] = asArray(record.inputs ?? []).map((entry) => {
    const inputRecord = asRecord(entry);
    return {
      inputType: asString(inputRecord.input_type) ?? 'Unknown',
      utxo: inputRecord.utxo !== undefined && inputRecord.utxo !== null ? parseOutput(inputRecord.utxo) : null,
    };
  });
  const outputs: MlOutput[] = asArray(record.outputs ?? []).map(parseOutput);
  const confirmations = asNumberOrNull(record.confirmations);
  return {
    id,
    inputs,
    outputs,
    fee: record.fee !== undefined && record.fee !== null ? parseAmount(record.fee) : null,
    blockId: asString(record.block_id),
    timestamp: asNumberOrNull(record.timestamp),
    confirmations: record.confirmations === '' ? null : confirmations,
  };
}

function parseTokenInfo(raw: unknown): MlTokenInfo {
  const record = asRecord(raw);
  return {
    authority: unquoted(record.authority) ?? '',
    ticker: unquoted(record.token_ticker),
    decimals: asNumberOrNull(record.number_of_decimals) ?? 0,
    circulatingSupply: record.circulating_supply !== undefined ? parseAmount(record.circulating_supply) : null,
    metadataUri: unquoted(record.metadata_uri),
    frozen: record.frozen === true,
  };
}

function parseNftInfo(id: string, raw: unknown): MlNftInfo {
  const record = asRecord(raw);
  return {
    id,
    name: unquoted(record.name),
    ticker: unquoted(record.ticker),
    description: unquoted(record.description),
    creator: unquoted(record.creator),
    owner: unquoted(record.owner),
    mediaUri: unquoted(record.media_uri),
    iconUri: unquoted(record.icon_uri),
    mediaHash: unquoted(record.media_hash),
  };
}

export class IndexerClient {
  private readonly base: string;

  private readonly timeoutMs: number;

  private readonly retries: number;

  private readonly fetchImpl: FetchLike;

  private readonly delay: (ms: number) => Promise<void>;

  constructor(base: string, opts?: IndexerClientOptions) {
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

  async tip(): Promise<Tip> {
    const raw = asRecord(await this.request('/chain/tip'));
    const height = asNumberOrNull(raw.block_height);
    const blockId = asString(raw.block_id);
    if (height === null || blockId === null) throw new IndexerError('parse', '/chain/tip', undefined);
    return { blockHeight: height, blockId };
  }

  /**
   * GET /address/{addr}. The documented 404 AddressNotFound (no history,
   * fresh wallet address) maps to the zero form: an unused address, never
   * a user-facing error (api-coverage.md, finding 1).
   */
  async addressInfo(address: string): Promise<MlAddressInfo> {
    const path = `/address/${encodeURIComponent(address)}`;
    let raw: Record<string, unknown>;
    try {
      raw = asRecord(await this.request(path));
    } catch (e) {
      if (e instanceof IndexerError && e.kind === 'http' && e.status === 404) {
        return { coinBalance: { atoms: '0' }, lockedCoinBalance: { atoms: '0' }, tokens: [], transactionHistory: [] };
      }
      throw e;
    }
    return {
      coinBalance: parseAmount(raw.coin_balance),
      lockedCoinBalance: parseAmount(raw.locked_coin_balance),
      tokens: asArray(raw.tokens ?? []).map((entry) => {
        const record = asRecord(entry);
        const tokenId = asString(record.token_id);
        if (tokenId === null) throw new IndexerError('parse', path, undefined);
        return { tokenId, amount: parseAmount(record.amount) };
      }),
      transactionHistory: asArray(raw.transaction_history ?? []).map((id) => {
        const txId = asString(id);
        if (txId === null) throw new IndexerError('parse', path, undefined);
        return txId;
      }),
    };
  }

  async spendableUtxos(address: string): Promise<MlUtxo[]> {
    return asArray(await this.request(`/address/${encodeURIComponent(address)}/spendable-utxos`)).map(parseUtxo);
  }

  async allUtxos(address: string): Promise<MlUtxo[]> {
    return asArray(await this.request(`/address/${encodeURIComponent(address)}/all-utxos`)).map(parseUtxo);
  }

  async transaction(id: string): Promise<MlTransaction> {
    return parseTransaction(await this.request(`/transaction/${encodeURIComponent(id)}`));
  }

  async token(id: string): Promise<MlTokenInfo> {
    return parseTokenInfo(await this.request(`/token/${encodeURIComponent(id)}`));
  }

  /** Ticker lookup; tickers are not unique (F6), so this returns every id. */
  async tokensByTicker(ticker: string): Promise<string[]> {
    const raw = await this.request(`/token/ticker/${encodeURIComponent(ticker)}`);
    return asArray(raw).map((entry) => {
      if (typeof entry === 'string') return entry;
      const tokenId = asString(asRecord(entry).token_id);
      if (tokenId === null) throw new IndexerError('parse', '/token/ticker', undefined);
      return tokenId;
    });
  }

  /** GET /nft/{id}; a 404 NFT not found (non-NFT id) resolves to null. */
  async nft(id: string): Promise<MlNftInfo | null> {
    try {
      return parseNftInfo(id, await this.request(`/nft/${encodeURIComponent(id)}`));
    } catch (e) {
      if (e instanceof IndexerError && e.kind === 'http' && e.status === 404) return null;
      throw e;
    }
  }

  /** Atoms per kB as a JSON string (cached server-side for 30s). */
  async feerate(inTopXMb?: number): Promise<string> {
    const query = inTopXMb === undefined ? undefined : { in_top_x_mb: String(inTopXMb) };
    const raw = await this.request('/feerate', query);
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) throw new IndexerError('parse', '/feerate', undefined);
    return raw;
  }

  async coinStatistics(): Promise<CoinStats> {
    const raw = asRecord(await this.request('/statistics/coin'));
    return {
      preminted: parseAmount(raw.preminted),
      staked: parseAmount(raw.staked),
      circulatingSupply: parseAmount(raw.circulating_supply),
      burned: parseAmount(raw.burned),
    };
  }

  async orderBook(base: string, quote: string, side: OrderBookSide, cursor?: string): Promise<OrderBookPage> {
    const query: Record<string, string> = { side };
    if (cursor !== undefined) query.cursor = cursor;
    const raw = asRecord(await this.request(`/order/pair/${encodeURIComponent(base)}_${encodeURIComponent(quote)}/book`, query));
    const levels: OrderBookLevel[] = asArray(raw.items ?? raw.levels ?? []).map((entry) => {
      const record = asRecord(entry);
      return { price: parseAmount(record.price), amount: parseAmount(record.amount) };
    });
    return {
      levels,
      nextCursor: asString(raw.next_cursor),
      truncated: raw.truncated === true,
    };
  }

  /**
   * Keyset cursor walk: pages until the envelope reports no next cursor (or
   * the scan cap with a null cursor), handing each page to the visitor. A
   * hostile or misbehaving endpoint that keeps serving a next cursor is
   * cut off by the page and item caps with a typed parse error, never an
   * unbounded request loop.
   */
  async walkCursor(
    path: string,
    query: Record<string, string> | undefined,
    onPage: (page: { items: unknown[]; nextCursor: string | null; truncated: boolean }) => Promise<void>,
    caps?: WalkerCaps,
  ): Promise<void> {
    const maxPages = caps?.maxPages ?? DEFAULT_MAX_PAGES;
    const maxItems = caps?.maxItems ?? DEFAULT_MAX_ITEMS;
    let cursor: string | undefined;
    let pages = 0;
    let items = 0;
    for (;;) {
      if (pages >= maxPages || items >= maxItems) {
        throw new IndexerError('parse', path, undefined);
      }
      const merged = { ...(query ?? {}) };
      if (cursor !== undefined) merged.cursor = cursor;
      const raw = asRecord(await this.request(path, Object.keys(merged).length > 0 ? merged : undefined));
      const pageItems = asArray(raw.items ?? []);
      const nextCursor = asString(raw.next_cursor);
      pages += 1;
      items += pageItems.length;
      await onPage({ items: pageItems, nextCursor, truncated: raw.truncated === true });
      if (nextCursor === null) return;
      cursor = nextCursor;
    }
  }

  /** Offset/items walk for list endpoints; stops at the first short page or
   *  the walker caps (typed parse error on a non-terminating listing). */
  async walkOffset(
    path: string,
    query: Record<string, string> | undefined,
    pageSize: number,
    onPage: (items: unknown[]) => Promise<void>,
    caps?: WalkerCaps,
  ): Promise<void> {
    const maxPages = caps?.maxPages ?? DEFAULT_MAX_PAGES;
    const maxItems = caps?.maxItems ?? DEFAULT_MAX_ITEMS;
    let pages = 0;
    let items = 0;
    for (let offset = 0; ; offset += pageSize) {
      if (pages >= maxPages || items >= maxItems) {
        throw new IndexerError('parse', path, undefined);
      }
      const merged = { ...(query ?? {}), items: String(pageSize), offset: String(offset) };
      const pageItems = asArray(await this.request(path, merged));
      pages += 1;
      items += pageItems.length;
      if (pageItems.length > 0) await onPage(pageItems);
      if (pageItems.length < pageSize) return;
    }
  }

  /** One request with timeout, typed errors and 429/5xx retry with backoff. */
  private async request(path: string, query?: Record<string, string>): Promise<unknown> {
    const qs = query && Object.keys(query).length > 0 ? `?${new URLSearchParams(query).toString()}` : '';
    const url = `${this.base}${path}${qs}`;
    let lastError: IndexerError | null = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) {
        const wait = lastError !== null && lastError.kind === 'http' && lastError.retryAfterMs !== undefined
          ? lastError.retryAfterMs
          : backoffMs(attempt - 1);
        await this.delay(wait);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Awaited<ReturnType<FetchLike>>;
      try {
        response = await this.fetchImpl(url, { signal: controller.signal });
      } catch {
        // Transport failure or our own timeout abort: typed, retriable.
        lastError = new IndexerError('transport', path, undefined);
        continue;
      } finally {
        clearTimeout(timer);
      }
      if (response.ok) {
        const declared = response.headers.get('content-length');
        if (declared !== null && /^\d+$/.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) {
          throw new IndexerError('parse', path, response.status);
        }
        const text = await response.text();
        if (text.length > MAX_RESPONSE_BYTES) throw new IndexerError('parse', path, response.status);
        try {
          return text.length === 0 ? null : (JSON.parse(text) as unknown);
        } catch {
          throw new IndexerError('parse', path, response.status);
        }
      }
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
      lastError = new IndexerError('http', path, response.status);
      lastError.retryAfterMs = retryAfterMs;
      const retriable = response.status === 429 || response.status >= 500;
      if (!retriable) throw lastError;
    }
    throw lastError ?? new IndexerError('http', path, undefined);
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  return Math.min(RETRY_AFTER_CAP_MS, Number(value) * 1000);
}
