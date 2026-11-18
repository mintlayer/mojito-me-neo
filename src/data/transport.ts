// Protocol-neutral HTTP transport shared by the chain clients (Mintlayer
// indexer, btc-api Esplora proxy): one retry loop with typed errors,
// response size caps and the JSON parse guards. Protocol-specific payload
// parsing stays in each client (ml/IndexerClient.ts, btc/BtcChainService.ts);
// nothing here knows either API.
//
// Failure policy: network failures, timeouts and non-JSON bodies map to
// typed TransportError values (transport, http, parse); raw server bodies
// never surface to the UI. 429 and 5xx responses retry with backoff.
// Backends that honor Retry-After pass the retryAfterMs hook (the ML
// indexer does, capped; BTC does not). Every request carries an
// AbortController timeout, and the injected fetch/delay keep both clients
// testable offline against fixture responses.

export type FetchLike = (
  url: string,
  init: { signal: AbortSignal; headers?: Record<string, string>; method?: string; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text: () => Promise<string>;
}>;

export type TransportErrorKind = 'http' | 'transport' | 'parse';

/** Typed failure of one chain-client request. The endpoint label names what
 *  failed ("response", "btc response", "btc amount"); ML code re-exports the
 *  class as IndexerError so one concept keeps one class identity across both
 *  clients. */
export class TransportError extends Error {
  /** Milliseconds from a Retry-After header, capped; read by the retry loop. */
  retryAfterMs?: number;

  constructor(
    readonly kind: TransportErrorKind,
    readonly endpoint: string,
    readonly status?: number,
  ) {
    super(`chain ${kind} error on ${endpoint}${status !== undefined ? ` (http ${status})` : ''}`);
    this.name = 'TransportError';
  }
}

const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 8_000;

/** Cap on one response body before JSON.parse: a hostile endpoint must not
 *  read a multi-GB body into memory. 4 MiB is far above any documented
 *  endpoint payload; both clients share it so the transports agree. */
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/** Cap on one parsed array (transactions, tokens, utxos): bounds the work
 *  a single hostile response can force. */
export const MAX_ARRAY_ITEMS = 5_000;

function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
}

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

/** Parse guard: an object or a typed parse error carrying `label`. */
export function asRecord(value: unknown, label = 'response'): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TransportError('parse', label, undefined);
  }
  return value as Record<string, unknown>;
}

/** Parse guard: an array within the item cap or a typed parse error. */
export function asArray(value: unknown, label = 'response', max = MAX_ARRAY_ITEMS): unknown[] {
  if (!Array.isArray(value)) throw new TransportError('parse', label, undefined);
  if (value.length > max) throw new TransportError('parse', label, undefined);
  return value;
}

/** Numeric-or-numeric-string guard; anything else is null, not a throw. */
export function asNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length > 0 && /^\d+$/.test(value)) return Number(value);
  return null;
}

export type RequestJsonConfig = {
  base: string;
  path: string;
  query?: Record<string, string>;
  /** Per-request abort timeout. */
  timeoutMs: number;
  /** Retry attempts for 429 and 5xx responses and transport errors. */
  retries: number;
  fetchImpl: FetchLike;
  /** Injected delay for deterministic backoff tests. */
  delay: (ms: number) => Promise<void>;
  /** Capped Retry-After hook for backends that honor the header (ML);
   *  absent means plain exponential backoff (BTC). */
  retryAfterMs?: (headers: { get(name: string): string | null }) => number | undefined;
  /** Request method; GET is the read shape every existing caller uses. */
  method?: 'GET' | 'POST';
  /** Raw request body for POST (hex payloads ride as exact text). */
  body?: string;
  /** Content-Type for POST bodies. */
  contentType?: string;
  /** Response body shape: JSON (default) or plain text (broadcast ids). */
  expect?: 'json' | 'text';
};

/** One request with timeout, typed errors and 429/5xx retry with backoff.
 *  The failure policy is identical for reads and POST writes: transport
 *  failures and 5xx retry, everything else fails typed with the endpoint
 *  label, and raw bodies never surface. */
export async function requestJson(cfg: RequestJsonConfig): Promise<unknown> {
  const qs = cfg.query && Object.keys(cfg.query).length > 0 ? `?${new URLSearchParams(cfg.query).toString()}` : '';
  const url = `${cfg.base}${cfg.path}${qs}`;
  const expectText = cfg.expect === 'text';
  const headers = cfg.body === undefined ? undefined : { 'Content-Type': cfg.contentType ?? 'text/plain' };
  const method = cfg.method;
  let lastError: TransportError | null = null;
  for (let attempt = 0; attempt <= cfg.retries; attempt++) {
    if (attempt > 0) {
      const wait = lastError !== null && lastError.retryAfterMs !== undefined ? lastError.retryAfterMs : backoffMs(attempt - 1);
      await cfg.delay(wait);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await cfg.fetchImpl(url, { signal: controller.signal, headers, method, body: cfg.body });
    } catch {
      // Transport failure or our own timeout abort: typed, retriable.
      lastError = new TransportError('transport', cfg.path, undefined);
      continue;
    } finally {
      clearTimeout(timer);
    }
    if (response.ok) {
      const declared = response.headers.get('content-length');
      if (declared !== null && /^\d+$/.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) {
        throw new TransportError('parse', cfg.path, response.status);
      }
      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) throw new TransportError('parse', cfg.path, response.status);
      if (expectText) return text;
      try {
        return text.length === 0 ? null : (JSON.parse(text) as unknown);
      } catch {
        throw new TransportError('parse', cfg.path, response.status);
      }
    }
    lastError = new TransportError('http', cfg.path, response.status);
    lastError.retryAfterMs = cfg.retryAfterMs?.(response.headers);
    const retriable = response.status === 429 || response.status >= 500;
    if (!retriable) throw lastError;
  }
  throw lastError ?? new TransportError('http', cfg.path, undefined);
}
