// Real price provider per missing-architecture gap 1 and the project
// decision log (R1):
// the production direction is self-hosted Mintlayer-operated infrastructure
// (direction chosen 2026-11-17, implementation pending). v1 always runs the
// mock price provider; this stub exists so wiring a configured priceBase
// later is a registration change only, and so a misconfigured deployment
// fails loudly with a typed error instead of silently showing fixture
// prices as real ones.
import type { PriceProvider } from '../providers/types';

export class PriceUnavailableError extends Error {
  constructor() {
    super('price backend not configured (R1: self-hosted provider pending)');
    this.name = 'PriceUnavailableError';
  }
}

export function createConfiguredPriceProvider(_priceBase: string): PriceProvider {
  const unavailable = async (): Promise<never> => {
    throw new PriceUnavailableError();
  };
  return {
    getSnapshots: unavailable,
    getHistory: unavailable,
    getCandles: unavailable,
  };
}
