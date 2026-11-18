// Mock-mode send service (R3 demo path): the three-step flow completes on
// the fixture fee schedule and the mock broadcaster, with the same address
// and amount validation the real service runs, so the demo exercises the
// honest error paths too. Results are labelled demo: the tx id is a
// deterministic fake and no rotation or chain state is touched.
import { SendError } from '../../send/errors';
import { validateAddress, parseSendAmount } from '../../send/validation';
import { atomsToDecimal } from '../../money';
import type { NetworkFlag } from '../../config/endpoints';
import type { BroadcastProvider, FeeTierId, SendQuote, SendService } from '../providers/types';

export type MockSendConfig = {
  broadcast: BroadcastProvider;
  network: NetworkFlag;
};

/** Fixture fee schedule in atom integers (ML at 11 decimals; BTC rides the
 *  same numbers at 8). Quote legs build on atomsToDecimal, never on float
 *  math: scaling the cost floats produced e-notation fee strings that
 *  crashed the review screen's decimalsToAtoms conversion. */
const ML_FEE_ATOMS: Record<FeeTierId, bigint> = { economy: 8_000_000n, standard: 12_000_000n, fast: 24_000_000n };
const BTC_FEE_ATOMS: Record<FeeTierId, bigint> = { economy: 8_000n, standard: 12_000n, fast: 24_000n };

function quote(feeAtoms: Record<FeeTierId, bigint>, decimals: number): SendQuote {
  const leg = (atoms: bigint): SendQuote['economy'] => ({
    feeDecimal: atomsToDecimal(atoms.toString(), decimals),
    feeAtoms: atoms.toString(),
    sizeBytes: 0,
    rateIsFallback: true,
  });
  return {
    economy: leg(feeAtoms.economy),
    standard: leg(feeAtoms.standard),
    fast: leg(feeAtoms.fast),
  };
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
      return quote(ML_FEE_ATOMS, 11);
    },

    async quoteBtc(params) {
      requireValid(params.to, 'btc');
      requireAmount(params.amountDecimal, 8);
      return quote(BTC_FEE_ATOMS, 8);
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
