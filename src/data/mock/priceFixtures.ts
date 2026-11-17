// Deterministic seeded price series (missing-architecture gap 1): charts look
// alive in dev and UI tests stay stable. No Math.random anywhere; the walk is
// derived from a mulberry32 PRNG seeded per token or pair.
import { ASSETS, BALANCE, MARKET } from '../../data';
import type { Candle, PricePoint, PriceProvider, PriceRange, PriceSnapshot } from '../providers/types';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Point counts per range (missing-architecture gap 1 data contract). */
const RANGE_POINTS: Record<PriceRange, number> = {
  '1H': 60, '4H': 240, '1D': 288, '1W': 168, '1M': 30, '1Y': 365, ALL: 500,
};

const INTERVAL_SECONDS: Record<string, number> = {
  '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400,
};

/** Random walk backwards from `last`, so the series ends at the known price. */
function walkBack(rand: () => number, last: number, points: number, volatility: number): number[] {
  const out = new Array<number>(points);
  out[points - 1] = last;
  for (let i = points - 2; i >= 0; i--) {
    const drift = (rand() - 0.48) * volatility * last;
    out[i] = Math.max(last * 0.5, out[i + 1] - drift);
  }
  return out;
}

export function createFixturePriceProvider(): PriceProvider {
  const lastPriceFor = (tokenId: string): number => {
    const asset = ASSETS.find((a) => a.sym === tokenId);
    return asset ? asset.price : MARKET.price;
  };

  const getSnapshots = async (tokenIds: string[]): Promise<PriceSnapshot[]> => {
    const now = Date.now();
    return tokenIds.map((tokenId) => {
      const asset = ASSETS.find((a) => a.sym === tokenId);
      return {
        tokenId,
        symbol: asset ? asset.sym : tokenId,
        usd: String(asset ? asset.price : 0),
        change24hPct: asset ? asset.change : 0,
        updatedAt: now,
      };
    });
  };

  const getHistory = async (tokenId: string, range: PriceRange): Promise<PricePoint[]> => {
    const rand = mulberry32(seedFrom(`${tokenId}:${range}`));
    const points = RANGE_POINTS[range];
    const last = tokenId === 'PORTFOLIO' ? BALANCE.spark[BALANCE.spark.length - 1] : lastPriceFor(tokenId);
    const series = walkBack(rand, last, points, 0.012);
    const now = Math.floor(Date.now() / 1000);
    const step = Math.max(60, Math.floor((7 * 24 * 3600) / points));
    return series.map((p, i) => ({ t: now - (points - 1 - i) * step, p }));
  };

  const getCandles = async (pair: string, interval: string): Promise<Candle[]> => {
    const rand = mulberry32(seedFrom(`${pair}:${interval}`));
    const count = 90;
    const stepSec = INTERVAL_SECONDS[interval] ?? 3600;
    const closes = walkBack(rand, MARKET.price, count, 0.02);
    const now = Math.floor(Date.now() / 1000);
    return closes.map((c, i) => {
      const o = i === 0 ? c * (1 - 0.004) : closes[i - 1];
      const hi = Math.max(o, c) * (1 + rand() * 0.006);
      const lo = Math.min(o, c) * (1 - rand() * 0.006);
      return { t: now - (count - 1 - i) * stepSec, o, h: hi, l: lo, c, v: Math.round(4000 + rand() * 16000) };
    });
  };

  return { getSnapshots, getHistory, getCandles };
}

export type { PriceProvider };
