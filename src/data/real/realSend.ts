// Real-mode send service (spec M3 deliverables 4, 5, 7 wired to screens):
// plan, build, sign and broadcast for ML and BTC, plus the post-send
// responsibilities (fresh-address rotation, tracker registration). The
// builders are pure seams consumed here; the seed only ever exists inside
// the injected withSession closure (the same vault pattern the data layer
// uses for xpub derivation), and no derived secret is cached or logged.
//
// Honest availability per R3 and the F13/F7 reality:
// - ML broadcast needs endpoints.broadcastBase (the A1 switch). Without it
//   the pipeline still plans, builds and signs, then fails typed-disabled
//   at the broadcast step; with the native bindings unavailable the sign
//   step rejects with the device-pending BindingsError.
// - BTC needs the btc-api base (F13); the scure build/sign path is fully
//   real and runs in the Node gate.
import { MlTxBuilder, type MlPlanResult } from '../../send/MlTxBuilder';
import type { MlUtxo } from '../ml/types';
import { IndexerError } from '../ml/IndexerClient';
import { MlTxSigner } from '../../send/MlTxSigner';
import { BtcTxBuilder, parsePinnedRate, type BtcPinnedRate } from '../../send/BtcTxBuilder';
import { SendError } from '../../send/errors';
import { validateAddress, parseSendAmount } from '../../send/validation';
import { TxTracker } from '../../send/TxTracker';
import type { KeySession } from '../../keys/session';
import type { BroadcastProvider, FeeTierId, SendQuote, SendResult, SendService } from '../providers/types';
import { BroadcastError } from '../providers/BroadcastProvider';
import type { MintlayerBindings } from '../../../modules/mojito-core';
import { ML_DECIMALS, atomsToDecimal } from '../../money';
import type { RealAccountContext } from './account';

export type RealSendConfig = {
  context: RealAccountContext;
  /** The active ML broadcast switch (endpoints.broadcastBase): null keeps
   *  the flow planning and signing but never broadcasting (R3/A1). */
  broadcastBase: string | null;
  /** The bindings facade loader (MojitoCore): signing and ML encoders ride
   *  the native call-through, the recorded device-pending seam. A thunk
   *  because the facade pulls the native bridge, which the Node gate must
   *  not load; tests inject an offline double here. */
  loadBindings: () => MintlayerBindings;
  broadcast: BroadcastProvider;
  tracker: TxTracker;
  /** Opens the vault session for signing; the session releases on return. */
  withSession: <T>(fn: (session: KeySession) => Promise<T>) => Promise<T>;
  /** Fixed BTC fallback rates, flagged to the UI when fee-estimates is
   *  unreachable (economy 3, standard 6, fast 12 sat/vB). */
  btcFallbackRates?: Record<FeeTierId, number>;
};

const DEFAULT_BTC_FALLBACK: Record<FeeTierId, number> = { economy: 3, standard: 6, fast: 12 };

/** BTC fee-estimates bucket per tier (spec M3 data section). */
const BTC_TARGETS: Record<FeeTierId, string> = { economy: '6', standard: '3', fast: '1' };

export function createRealSend(cfg: RealSendConfig): SendService {
  const { context, broadcast, tracker, withSession } = cfg;
  const btcFallback = cfg.btcFallbackRates ?? DEFAULT_BTC_FALLBACK;
  const mlNetwork = context.cfg.network === 'testnet' ? ('testnet' as const) : ('mainnet' as const);
  let bindings: MintlayerBindings | null = null;
  function requireBindings(): MintlayerBindings {
    if (bindings === null) bindings = cfg.loadBindings();
    return bindings;
  }

  /** Send serialization (one send at a time per service): the plan, sign,
   *  broadcast and rotate section reads live UTXOs and read-modify-writes
   *  the persisted derivation indexes, so a second overlapping send would
   *  select the same UTXOs and race the counters. Refused typed instead of
   *  queued: a queued send would sign a plan built on state the first send
   *  is about to invalidate. The per-screen sending flag cannot provide
   *  this: any second consumer of the service must hit the same guard. */
  let inFlight = false;
  function serialize<T>(fn: () => Promise<T>): Promise<T> {
    if (inFlight) return Promise.reject(new SendError('busy', 'another send is still in progress'));
    inFlight = true;
    return fn().finally(() => {
      inFlight = false;
    });
  }

  /** Post-broadcast contract: verify the network answer against the locally
   *  computed id (a lying backend must not poison the tracker), track the
   *  local id, then rotate. The transaction is on the network at this
   *  point, so a storage failure in bookkeeping surfaces as success with a
   *  warning, never as a failed send inviting a retry. */
  async function finishSend(kind: 'ml' | 'btc', answeredTxId: string, localTxId: string, rotate: () => Promise<void>): Promise<SendResult> {
    if (answeredTxId.toLowerCase() !== localTxId.toLowerCase()) {
      throw new SendError('txid-mismatch', `broadcast answered ${answeredTxId}, locally signed ${localTxId}`);
    }
    try {
      tracker.track({ id: localTxId, chain: kind });
      await rotate();
    } catch {
      return { txId: localTxId, kind, demo: false, warning: true };
    }
    return { txId: localTxId, kind, demo: false };
  }

  /** Public xpubs, derived once per service instance (public material,
   *  persistable; the vault session releases right after derivation). */
  let xpubs: Promise<{ btcXpub: string }> | null = null;
  function publicXpubs(): Promise<{ btcXpub: string }> {
    if (xpubs === null) {
      xpubs = context.cfg.deriveXpubs().then((pair) => ({ btcXpub: pair.btcXpub })).catch((e: unknown) => {
        xpubs = null;
        throw e;
      });
    }
    return xpubs;
  }

  async function mlBuilder(): Promise<{ builder: MlTxBuilder; indexer: NonNullable<RealAccountContext['indexer']> }> {
    context.requireIndexerBase();
    const indexer = context.indexer;
    if (indexer === null) throw new IndexerError('transport', 'indexer', undefined);
    return { builder: new MlTxBuilder(requireBindings(), indexer, mlNetwork), indexer };
  }

  async function btcRateSource(tier: FeeTierId): Promise<{ satPerVbyte: number; fallback: boolean }> {
    const acct = await context.ensureAccount();
    if (acct.btc === null) return { satPerVbyte: btcFallback[tier], fallback: true };
    try {
      const estimates = await acct.btc.feeEstimates();
      const target = estimates[BTC_TARGETS[tier]];
      if (typeof target === 'number' && target > 0 && Number.isFinite(target)) return { satPerVbyte: target, fallback: false };
    } catch {
      // fee-estimates unreachable: the fixed fallback applies, flagged.
    }
    return { satPerVbyte: btcFallback[tier], fallback: true };
  }

  async function mlPlan(params: { to: string; amountDecimal: string; tier: FeeTierId; decimals: number; tokenId?: string }): Promise<MlPlanResult> {
    const { builder, indexer } = await mlBuilder();
    const amount = parseSendAmount(params.amountDecimal, params.decimals);
    if (!amount.ok) throw new SendError('rejected', amount.error === 'tooManyDecimals' ? 'too many decimals' : 'amount not parseable');
    const acct = await context.ensureAccount();
    const fromAddresses = await acct.manager.allAddresses('ml');
    const utxos: MlUtxo[] = [];
    for (const address of fromAddresses) utxos.push(...(await indexer.spendableUtxos(address)));
    return builder.plan({ fromAddresses, to: params.to, amountAtoms: amount.atoms, tier: params.tier, tokenId: params.tokenId, utxos });
  }

  function mapBroadcastError(e: unknown): unknown {
    if (e instanceof BroadcastError) {
      const kind = e.failure === 'disabled' ? 'broadcast-disabled' : e.failure === 'network' ? 'timeout' : 'broadcast-failed';
      return new SendError(kind, e.detail);
    }
    return e;
  }

  return {
    canBroadcast(chain) {
      if (chain === 'btc') return context.cfg.btcBase !== null;
      return cfg.broadcastBase !== null;
    },

    async quoteMl(params) {
      const tiers: FeeTierId[] = ['economy', 'standard', 'fast'];
      const quotes = {} as Record<FeeTierId, SendQuote[FeeTierId]>;
      for (const tier of tiers) {
        const plan = await mlPlan({ ...params, tier });
        quotes[tier] = {
          feeDecimal: atomsToDecimal(plan.feeAtoms, ML_DECIMALS),
          feeAtoms: plan.feeAtoms,
          sizeBytes: plan.sizeBytes,
          rateAtomsPerKb: plan.rateAtomsPerKb,
          rateIsFallback: false,
          changeAtoms: plan.changeAtoms,
        };
      }
      return quotes;
    },

    async sendMl(params) {
      return serialize(async () => {
        const to = params.to.trim();
        if (validateAddress(to, 'ml', context.cfg.network) !== null) throw new SendError('invalid-address', to);
        const plan = await mlPlan({ ...params, tier: params.tier });
        const { builder, indexer } = await mlBuilder();
        const acct = await context.ensureAccount();
        // Address allocation happens inside the serialized section, after
        // every await of the plan, so two sends can never share an index.
        const changeAddress = await acct.manager.allocateChangeAddress('ml');
        const unsigned = await builder.build({ ...plan, to, changeAddress });
        const tip = await indexer.tip();
        const signer = new MlTxSigner(requireBindings(), mlNetwork);
        const signedHex = await withSession((session) => signer.sign(unsigned, session, tip.blockHeight + 1));
        let result: { txId: string };
        try {
          result = await broadcast.broadcastMl(signedHex);
        } catch (e) {
          throw mapBroadcastError(e);
        }
        // The unsigned tx id survives signing (witnesses are separate), so
        // it is the locally computed id the broadcast answer must match.
        return finishSend('ml', result.txId, unsigned.txId, async () => {
          await acct.manager.freshReceivingAddress('ml');
        });
      });
    },

    async quoteBtc(params) {
      const amount = parseSendAmount(params.amountDecimal, 8);
      if (!amount.ok) throw new SendError('rejected', amount.error === 'tooManyDecimals' ? 'too many decimals' : 'amount not parseable');
      const amountSat = BigInt(amount.atoms);
      const acct = await context.ensureAccount();
      if (acct.btc === null) throw new SendError('broadcast-disabled', 'no btc-api base is configured');
      // A quote never mutates the change bookkeeping: it previews on the
      // next branch 1 address without advancing or persisting the index.
      // Allocation happens exactly once, inside sendBtc's serialized
      // section, so the reviewed change address is the sent one.
      const fromAddresses = await acct.manager.allAddresses('btc');
      const changeAddress = await acct.manager.peekChangeAddress('btc');
      const builder = new BtcTxBuilder({ network: context.cfg.network, utxos: acct.btc, rateSource: btcRateSource, changeAddress });
      const { btcXpub } = await publicXpubs();
      const tiers: FeeTierId[] = ['economy', 'standard', 'fast'];
      const quotes = {} as Record<FeeTierId, SendQuote[FeeTierId]>;
      for (const tier of tiers) {
        const plan = await builder.plan({ accountXpub: btcXpub, fromAddresses, to: params.to.trim(), amountSat, tier });
        quotes[tier] = {
          feeDecimal: atomsToDecimal(plan.feeSat, 8),
          feeAtoms: plan.feeSat,
          sizeBytes: plan.vsize,
          satPerVbyte: plan.satPerVbyte,
          rateIsFallback: plan.rateIsFallback,
          changeAtoms: plan.changeSat,
        };
      }
      return quotes;
    },

    async sendBtc(params) {
      return serialize(async () => {
        const to = params.to.trim();
        if (validateAddress(to, 'btc', context.cfg.network) !== null) throw new SendError('invalid-address', to);
        const amount = parseSendAmount(params.amountDecimal, 8);
        if (!amount.ok) throw new SendError('rejected', amount.error === 'tooManyDecimals' ? 'too many decimals' : 'amount not parseable');
        const acct = await context.ensureAccount();
        if (acct.btc === null) throw new SendError('broadcast-disabled', 'no btc-api base is configured');
        // Fee pinning: the reviewed rate signs, the live rate guards. A
        // fresh estimate above the reviewed one refuses typed (fail safe:
        // never pay more than reviewed); at or below it the pinned rate
        // keeps the signed fee equal to the reviewed plan.
        const pinned: BtcPinnedRate | undefined =
          params.satPerVbyte === undefined
            ? undefined
            : { satPerVbyte: params.satPerVbyte, isFallback: params.rateIsFallback ?? false };
        if (pinned !== undefined) {
          const fresh = await btcRateSource(params.tier);
          if (BigInt(Math.ceil(fresh.satPerVbyte)) > BigInt(Math.ceil(parsePinnedRate(pinned.satPerVbyte)))) {
            throw new SendError('stale-fee', `fee estimate moved from ${pinned.satPerVbyte} to ${fresh.satPerVbyte} sat/vB`);
          }
        }
        // Fund across every managed address: change from earlier sends sits
        // on branch 1 and older UTXOs on earlier receiving indexes, and the
        // builder signs each selected input with its own origin.
        const fromAddresses = await acct.manager.allAddresses('btc');
        // Allocation stays inside the serialized section, so a concurrent
        // send can never share this change address or race the counter.
        const changeAddress = await acct.manager.allocateChangeAddress('btc');
        const builder = new BtcTxBuilder({ network: context.cfg.network, utxos: acct.btc, rateSource: btcRateSource, changeAddress });
        const { btcXpub } = await publicXpubs();
        const signed = await withSession((session) =>
          session.withSeed((seed) =>
            builder.buildAndSign({
              seed,
              accountXpub: btcXpub,
              fromAddresses,
              to,
              amountSat: BigInt(amount.atoms),
              tier: params.tier,
              pinnedRate: pinned,
            }),
          ),
        );
        let result: { txId: string };
        try {
          result = await broadcast.broadcastBtc(signed.hex);
        } catch (e) {
          throw mapBroadcastError(e);
        }
        return finishSend('btc', result.txId, signed.txid, async () => {
          await acct.manager.freshReceivingAddress('btc');
        });
      });
    },
  };
}
