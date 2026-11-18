// Live order book (spec M4 deliverable 2): aggregated price levels from
// GET /order/pair/{base}_{quote}/book with keyset cursor pagination, mapped
// onto the depth rows the DexScreen renders. The server returns already
// aggregated levels; this service pages them until the requested depth is
// visible and converts every figure to a decimal string at the display
// boundary (no float money math in state).
//
// Honesty rules: a book that cannot be fetched throws (the screen renders
// the error state, never fixture rows), and last() stays null because the
// indexer exposes no trades endpoint this service could trust (F11: the
// null keeps the last-fill figure honest instead of a stale fabrication).
import { atomsToDecimal, ML_DECIMALS } from '../money';
import { IndexerError, type IndexerClient, type OrderBookSide } from '../data/ml/IndexerClient';
import type { AmountJson } from '../data/ml/types';

/** One rendered book row: price and size in base/quote decimals plus the
 *  running total the depth bar scales against. */
export type BookRow = { price: string; size: string; total: string };

export interface OrderBookService {
  /** Aggregated levels for one side, best price first, up to depth. */
  levels(base: string, quote: string, side: OrderBookSide, depth?: number): Promise<BookRow[]>;
  /** Last fill price; always null today (no trusted trades endpoint). */
  last(): Promise<string | null>;
}

export type OrderBookServiceConfig = {
  /** The indexer reader seam (orderBook only). */
  reader: Pick<IndexerClient, 'orderBook'>;
  /** Cursor pages fetched per levels() call at most. */
  maxPages?: number;
};

const DEFAULT_MAX_PAGES = 8;

/** Book depth the screen renders (6 asks + 6 bids around the spread). */
export const DEFAULT_BOOK_DEPTH = 6;

/** Decimal digits used when flattening the server's num/denom price
 *  rational; a truncated display price never feeds money math. */
const PRICE_FRACTION_DIGITS = 8;

/** Parse a decimal string into a scaled BigInt (digits * 10^scale). */
function scaledOf(decimal: string): { digits: bigint; scale: number } {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(decimal.trim());
  if (!match) throw new IndexerError('parse', 'book level', undefined);
  const frac = match[2] ?? '';
  return { digits: BigInt(match[1] + frac), scale: frac.length };
}

/** Rescale a scaled value to a plain decimal string. */
function toDecimal(digits: bigint, scale: number): string {
  if (digits === 0n) return '0';
  const text = digits.toString().padStart(scale + 1, '0');
  const int = text.slice(0, text.length - scale).replace(/^0+(?=\d)/, '');
  const frac = scale === 0 ? '' : text.slice(text.length - scale).replace(/0+$/, '');
  return frac.length > 0 ? `${int}.${frac}` : int;
}

/** Price as a decimal string: the server decimal when present, otherwise
 *  the documented num/denom rational flattened at display precision. */
export function bookPriceDecimal(price: AmountJson): string {
  if (price.decimal !== undefined) return price.decimal;
  const atoms = price.atoms ?? '';
  const rational = /^(\d+)\/(\d+)$/.exec(atoms);
  if (rational) {
    const num = BigInt(rational[1]);
    const denom = BigInt(rational[2]);
    if (denom === 0n) throw new IndexerError('parse', 'book level', undefined);
    const scale = 10n ** BigInt(PRICE_FRACTION_DIGITS);
    return toDecimal((num * scale) / denom, PRICE_FRACTION_DIGITS);
  }
  throw new IndexerError('parse', 'book level', undefined);
}

export function createOrderBookService(cfg: OrderBookServiceConfig): OrderBookService {
  const maxPages = cfg.maxPages ?? DEFAULT_MAX_PAGES;

  async function levels(base: string, quote: string, side: OrderBookSide, depth = DEFAULT_BOOK_DEPTH): Promise<BookRow[]> {
    const rows = await walkLevels(base, quote, side, depth, true);
    return rows;
  }

  /** Page walk with one invalid-cursor restart (api-coverage notes: cursors
   *  are opaque and can go stale; refetching page 1 is the documented
   *  recovery). Depth flicker on the restart is accepted for v1. */
  async function walkLevels(base: string, quote: string, side: OrderBookSide, depth: number, allowRestart: boolean): Promise<BookRow[]> {
    const rows: BookRow[] = [];
    let cursor: string | undefined;
    let restarted = false;
    for (let page = 0; page < maxPages && rows.length < depth; page++) {
      let levelPage;
      try {
        levelPage = await cfg.reader.orderBook(base, quote, side, cursor);
      } catch (e) {
        if (allowRestart && !restarted && cursor !== undefined && e instanceof IndexerError && e.kind === 'http' && e.status === 400) {
          // The stale cursor page poisoned the accumulated rows: rebuild
          // from page 1 so no mixed-generation row survives.
          restarted = true;
          rows.length = 0;
          cursor = undefined;
          page = -1;
          continue;
        }
        throw e;
      }
      for (const level of levelPage.levels) {
        if (rows.length >= depth) break;
        const price = bookPriceDecimal(level.price);
        const size = atomsToDecimal(atomsOfLevel(level.amount), ML_DECIMALS);
        const p = scaledOf(price);
        const s = scaledOf(size);
        // total = price * size, scaled once at the wider precision.
        const totalDigits = p.digits * s.digits;
        const totalScale = p.scale + s.scale;
        rows.push({ price, size, total: toDecimal(totalDigits, totalScale) });
      }
      if (levelPage.nextCursor === null) break;
      cursor = levelPage.nextCursor;
    }
    return rows;
  }

  return {
    levels,
    // No aggregated trades endpoint is consumed in v1: null keeps the
    // last-fill row honest (the screen hides it instead of guessing).
    last: async () => null,
  };
}

/** Base-currency atoms of one aggregated level. */
function atomsOfLevel(amount: AmountJson): string {
  if (amount.atoms !== undefined) return amount.atoms;
  throw new IndexerError('parse', 'book level', undefined);
}
