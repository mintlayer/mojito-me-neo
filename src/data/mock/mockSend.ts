// Mock-mode send service (R3 demo path): the three-step flow completes on
// the fixture fee schedule and the mock broadcaster, with the same address
// and amount validation the real service runs, so the demo exercises the
// honest error paths too. Results are labelled demo: the tx id is a
// deterministic fake and no rotation or chain state is touched.
import { FEES } from '../../data';
import { SendError } from '../../send/errors';
import { validateAddress, parseSendAmount } from '../../send/validation';
import type { NetworkFlag } from '../../config/endpoints';
import type { BroadcastProvider, SendQuote, SendService } from '../providers/types';

export type MockSendConfig = {
  broadcast: BroadcastProvider;
  network: NetworkFlag;
};

function quoteFor(cost: number, decimals: number): SendQuote {
  const feeAtoms = (BigInt(Math.round(cost * 10 ** decimals)) ).toString();
  const leg = (rateIsFallback: boolean) => ({
    feeDecimal: String(cost),
    feeAtoms,
    sizeBytes: 0,
    rateIsFallback,
  });
  return { economy: leg(true), standard: leg(true), fast: leg(true) };
}

export function createMockSend(cfg: MockSendConfig): SendService {
  /** Deterministic fake payload per send params: hex only, mock-broadcast
   *  digestible, no chain meaning. */
  function payload(parts: (string | number)[]): string {
    let h = 0x9e3779b9;
    let out = '';
    for (const part of parts) {
      const text = String(part);
      for (let i = 0; i < text.length; i++) {
        h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
      }
    }
    for (let b = 0; b < 120; b++) {
      h = (Math.imul(h, 1664525) + 1013904223) | 0;
      out += ((h >>> 28) & 0xf).toString(16);
    }
    return out;
  }

  function requireValid(to: string, chain: 'ml' | 'btc'): void {
    if (validateAddress(to, chain, cfg.network) !== null) {
      throw new SendError('invalid-address', to);
    }
  }

  function requireAmount(amountDecimal: string, decimals: number): string {
    const parsed = parseSendAmount(amountDecimal, decimals);
    if (!parsed.ok) throw new SendError('rejected', parsed.error === 'tooManyDecimals' ? 'too many decimals' : 'amount not parseable');
    return parsed.atoms;
  }

  return {
    // The mock broadcaster is the R3 demo path: broadcasting always "works".
    canBroadcast: () => true,

    async quoteMl(params) {
      requireValid(params.to, 'ml');
      requireAmount(params.amountDecimal, params.decimals);
      return quoteFor(FEES.standard.cost, 11);
    },

    async quoteBtc(params) {
      requireValid(params.to, 'btc');
      requireAmount(params.amountDecimal, 8);
      return quoteFor(FEES.standard.cost / 1000, 8);
    },

    async sendMl(params) {
      requireValid(params.to, 'ml');
      requireAmount(params.amountDecimal, params.decimals);
      const { txId } = await cfg.broadcast.broadcastMl(payload(['ml', params.to, params.amountDecimal, params.tier, params.tokenId ?? '']));
      return { txId, kind: 'ml', demo: true };
    },

    async sendBtc(params) {
      requireValid(params.to, 'btc');
      requireAmount(params.amountDecimal, 8);
      const { txId } = await cfg.broadcast.broadcastBtc(payload(['btc', params.to, params.amountDecimal, params.tier]));
      return { txId, kind: 'btc', demo: true };
    },
  };
}
