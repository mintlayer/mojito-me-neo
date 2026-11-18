// On-chain order flows (spec M4 deliverable 1, F11 order model): create,
// fill and conclude mapped from the indexer data plus the bindings order
// encoders. An order locks the give amount and asks the ask amount; takers
// pay the fill amount of the ask currency from their own UTXOs and receive
// the proportional give payout (filled = give * fill / ask, floor division;
// orders V1 prices on the original balances, mintlayer-core
// orders-accounting). Conclude returns the leftovers to the conclude
// destination.
//
// Witness mix (F11/rust-sdk docs): fill and conclude order inputs must not
// be signed (encodeWitnessNoSignature); the payer UTXO inputs carry normal
// signed witnesses assembled here with the M3 signing contract (per-input
// spent output for the sighash, keys only inside the vault session).
//
// Every transaction assembles over the MintlayerBindings interface seam.
// Without the native call-through the bindings reject, which surfaces as
// the honest device-pending state (modules/mojito-core header), never a
// JavaScript reimplementation of the encoding.
import { hex as hexOf } from '@scure/base';
import { bytesToHex } from '@noble/hashes/utils.js';

import type { MintlayerBindings, MlNetwork } from '../../modules/mojito-core';
import type { IndexerClient } from '../data/ml/IndexerClient';
import type { BroadcastProvider } from '../data/providers/types';
import type { MlOrderInfo, MlUtxo } from '../data/ml/types';
import type { KeySession } from '../keys/session';
import { mlAddressAt, mlPrivateKeyFromSeed, mlXpubFromSeed, type MlBranch } from '../keys/mlAccounts';
import { selectMlInputs, type EstimatedMlOutput, type SelectedMlInput } from '../send/MlTxBuilder';
import { BroadcastError } from '../data/providers/BroadcastProvider';
import { checkSlippage } from './priceGuards';

/** Sentinel marking the base coin (give_token '0' in the F11 docs model;
 *  the bindings OrderParams spelling is 'coin'). */
export const COIN_REF = 'coin' as const;

/** Fractional digits kept when flattening the effective fill price
 *  (display-scale comparison against the book mid; no float money math). */
const EFFECTIVE_PRICE_DIGITS = 8;

/** num/denom as a decimal string at fixed digits, pure BigInt. */
function rationalDecimal(num: bigint, denom: bigint): string {
  if (denom <= 0n) throw new OrderFlowError('rejected', 'the effective price is not computable');
  const scaled = (num * 10n ** BigInt(EFFECTIVE_PRICE_DIGITS)) / denom;
  const text = scaled.toString().padStart(EFFECTIVE_PRICE_DIGITS + 1, '0');
  const int = text.slice(0, text.length - EFFECTIVE_PRICE_DIGITS);
  const frac = text.slice(text.length - EFFECTIVE_PRICE_DIGITS);
  return frac.length > 0 ? `${int}.${frac}` : int;
}

export type OrderData = {
  orderId: string;
  /** 'coin' marks the base coin, otherwise the token id. */
  giveTokenId: string;
  giveBalanceAtoms: string;
  askTokenId: string;
  askBalanceAtoms: string;
  concludeDestination: string;
  nonce: string | null;
  /** Maker freeze flag when the indexer serves it; freezes reject fills. */
  frozen: boolean;
};

export type OrderPhase = 'open' | 'frozen' | 'concluded';

/** Lifecycle phase (F11: open -> frozen -> concluded). Concluded orders
 *  carry zero balances on both legs; freezing is maker-only and detected
 *  from the state field. */
export function orderPhase(order: OrderData): OrderPhase {
  if (order.giveBalanceAtoms === '0' && order.askBalanceAtoms === '0') return 'concluded';
  if (order.frozen) return 'frozen';
  return 'open';
}

/** Map an indexer order row onto the wallet's order model. */
export function orderFromIndexer(info: MlOrderInfo): OrderData {
  return {
    orderId: info.orderId,
    giveTokenId: currencyRef(info.giveCurrency),
    giveBalanceAtoms: info.giveBalance.atoms ?? '0',
    askTokenId: currencyRef(info.askCurrency),
    askBalanceAtoms: info.askBalance.atoms ?? '0',
    concludeDestination: info.concludeDestination,
    nonce: null,
    frozen: info.frozen === true,
  };
}

function currencyRef(side: MlOrderInfo['giveCurrency']): string {
  if (side.type === 'Coin') return COIN_REF;
  if (side.tokenId !== undefined) return side.tokenId;
  throw new OrderFlowError('rejected');
}

export interface OrderFlows {
  /** Lock the give amount in a new order; the order id comes from the
   *  bindings on the create tx output. */
  createOrder(params: { giveTokenId: string; giveAtoms: string; askTokenId: string; askAtoms: string }): Promise<{ txId: string; orderId: string }>;
  /** Pay fillAtoms of the ask currency into an order; the proportional
   *  give payout lands on destination. The price band re-checks the
   *  effective fill price against the book mid before anything is built. */
  fillOrder(params: { orderId: string; fillAtoms: string; destination: string; priceBand: PriceBand }): Promise<{ txId: string }>;
  /** Close an order (maker only) and return the leftovers to the conclude
   *  destination. */
  concludeOrder(params: { orderId: string }): Promise<{ txId: string }>;
  /** Open orders for one pair (base and quote are tickers or token ids;
   *  the indexer pair route normalizes direction). */
  openOrders(base: string, quote: string): Promise<OrderData[]>;
  /** Orders whose conclude destination is one of this wallet's addresses. */
  myOrders(): Promise<OrderData[]>;
}

/** Slippage band for the fill: the effective price computed from the
 *  fetched order must stay within maxSlippagePct of the book mid. The
 *  decimals are the display decimals of the two currencies, because the
 *  effective price crosses two atom scales. */
export type PriceBand = {
  midDecimal: string;
  maxSlippagePct: number;
  askDecimals: number;
  giveDecimals: number;
};

export type OrderFlowsConfig = {
  network: MlNetwork;
  /** The bindings facade loader (MojitoCore): a thunk because the facade
   *  pulls the native bridge, which the Node gate must not load (the
   *  realSend config carries the same lazy seam). */
  loadBindings: () => MintlayerBindings;
  indexer: Pick<IndexerClient, 'orders' | 'order' | 'feerate' | 'spendableUtxos' | 'tip'> & {
    /** Pair-filtered open orders (GET /order/pair/{base}_{quote}). */
    ordersByPair(base: string, quote: string): Promise<MlOrderInfo[]>;
  };
  broadcast: BroadcastProvider;
  /** All managed ML addresses (selection and the myOrders filter). */
  addresses: () => Promise<string[]>;
  /** Branch 1 change allocation (fresh address per transaction). */
  allocateChangeAddress: () => Promise<string>;
  /** Step back the change counter of a failed attempt (realSend pattern). */
  releaseFailedChange: () => Promise<void>;
  withSession: <T>(fn: (session: KeySession) => Promise<T>) => Promise<T>;
};

const STANDARD_TIER_IN_TOP_MB = 1;

/** Bounded derivation walk when mapping an input address back to its path;
 *  aligned with MlTxSigner and the AddressManager scan ceiling. */
const ORIGIN_WALK_LIMIT = 512;

export class OrderFlowError extends Error {
  constructor(
    readonly reason: 'rejected' | 'busy' | 'not-open' | 'overbid' | 'not-mine' | 'slippage' | 'broadcast-disabled',
    detail?: string,
  ) {
    super(detail ?? `order flow rejected: ${reason}`);
    this.name = 'OrderFlowError';
  }
}

export function createOrderFlows(cfg: OrderFlowsConfig): OrderFlows {
  let bindings: MintlayerBindings | null = null;
  function b(): MintlayerBindings {
    if (bindings === null) bindings = cfg.loadBindings();
    return bindings;
  }
  /** Account-nonce counter for the order fill and conclude inputs (the
   *  bindings docs: the nonce must sequence with the filler's other
   *  account spendings). Session-scoped until the wallet persists the
   *  account nonce with its state; the native call-through must not go
   *  live before that (project decision log). */
  let accountNonce = 0;
  /** One order transaction at a time: selection reads live UTXOs and the
   *  change allocation mutates the persisted counters (realSend pattern). */
  let inFlight = false;
  function serialize<T>(fn: () => Promise<T>): Promise<T> {
    if (inFlight) return Promise.reject(new OrderFlowError('busy'));
    inFlight = true;
    return fn().finally(() => {
      inFlight = false;
    });
  }

  function requireAtomAmount(value: string): string {
    if (!/^\d+$/.test(value) || BigInt(value) === 0n) throw new OrderFlowError('rejected', 'amount must be a positive atom string');
    return value;
  }

  async function fetchUtxos(): Promise<MlUtxo[]> {
    const lists: MlUtxo[] = [];
    for (const address of await cfg.addresses()) lists.push(...(await cfg.indexer.spendableUtxos(address)));
    return lists;
  }

  /** Inputs for one selected UTXO: encoded outpoint source plus input. */
  async function utxoInput(selected: SelectedMlInput): Promise<Uint8Array> {
    const sourceId = hexOf.decode(selected.utxo.outpoint.sourceId);
    if (sourceId.length !== 32) throw new OrderFlowError('rejected', 'outpoint source id must be 32 bytes');
    const outpointSource = await b().encodeOutpointSourceId(
      sourceId,
      selected.utxo.outpoint.sourceType === 'BlockReward' ? 'block-reward' : 'transaction',
    );
    return b().encodeInputForUtxo(outpointSource, selected.utxo.outpoint.index);
  }

  /** Re-encoded spent output of one selected input (M3 sighash contract). */
  async function spentOutput(selected: SelectedMlInput): Promise<Uint8Array> {
    return selected.tokenId === null
      ? b().encodeOutputTransfer(selected.atoms, selected.address, cfg.network)
      : b().encodeOutputTokenTransfer(selected.tokenId, selected.atoms, selected.address, cfg.network);
  }

  /** Sign the payer inputs; prebuilt entries (the no-signature order
   *  witness at its absolute input index) pass through untouched. */
  async function sign(
    transaction: Uint8Array,
    payerInputs: SelectedMlInput[],
    prebuiltWitnesses: Map<number, Uint8Array>,
    session: KeySession,
    inclusionHeight: number,
  ): Promise<string> {
    return session.withSeed(async (seed) => {
      const { xpub } = mlXpubFromSeed(seed, cfg.network as 'mainnet' | 'testnet');
      const inputCount = payerInputs.length + prebuiltWitnesses.size;
      // F8: the sighash needs the spent output per transaction input;
      // order inputs carry no spent UTXO (null slot).
      const inputUtxos: (Uint8Array | null)[] = [];
      let payerWalk = 0;
      for (let inputIndex = 0; inputIndex < inputCount; inputIndex++) {
        if (prebuiltWitnesses.has(inputIndex)) {
          inputUtxos.push(null);
        } else {
          inputUtxos.push(await spentOutput(payerInputs[payerWalk++]));
        }
      }
      const witnesses: Uint8Array[] = [];
      let payerCursor = 0;
      for (let inputIndex = 0; inputIndex < inputCount; inputIndex++) {
        const prebuilt = prebuiltWitnesses.get(inputIndex);
        if (prebuilt !== undefined) {
          witnesses.push(prebuilt);
          continue;
        }
        const payer = payerInputs[payerCursor++];
        if (!payer) throw new OrderFlowError('rejected', 'payer input missing');
        const origin = await resolveOrigin(xpub, payer.address);
        const privateKey = mlPrivateKeyFromSeed(seed, cfg.network as 'mainnet' | 'testnet', origin.branch, origin.index);
        witnesses.push(
          await b().encodeWitness({
            sighashType: 'all',
            privateKey,
            address: payer.address,
            transaction,
            inputUtxos,
            inputIndex,
            inclusionHeight,
            network: cfg.network,
          }),
        );
      }
      const signed = await b().encodeSignedTransaction(transaction, witnesses);
      return bytesToHex(signed);
    });
  }

  async function resolveOrigin(xpub: Uint8Array, address: string): Promise<{ branch: MlBranch; index: number }> {
    for (const branch of [0, 1] as MlBranch[]) {
      for (let index = 0; index < ORIGIN_WALK_LIMIT; index++) {
        if ((await mlAddressAt(xpub, branch, index, cfg.network as 'mainnet' | 'testnet')) === address) {
          return { branch, index };
        }
      }
    }
    throw new OrderFlowError('rejected', 'input address does not derive from this wallet');
  }

  /** Encode and sign the assembled transaction, then broadcast. */
  async function finish(
    inputs: Uint8Array[],
    outputs: Uint8Array[],
    payerInputs: SelectedMlInput[],
    prebuiltWitnesses: Map<number, Uint8Array>,
  ): Promise<{ txId: string; transaction: Uint8Array }> {
    const transaction = await b().encodeTransaction(inputs, outputs, 0);
    const localTxId = await b().getTransactionId(transaction, false);
    const tip = await cfg.indexer.tip();
    const signedHex = await cfg.withSession((session) => sign(transaction, payerInputs, prebuiltWitnesses, session, tip.blockHeight + 1));
    const result = await cfg.broadcast.broadcastMl(signedHex).catch((e: unknown) => {
      if (e instanceof BroadcastError && e.failure === 'disabled') {
        throw new OrderFlowError('broadcast-disabled');
      }
      throw e;
    });
    // A lying backend must not hand back an id that does not match the
    // locally computed transaction (M3 finishSend contract).
    if (result.txId.toLowerCase() !== localTxId.toLowerCase()) {
      throw new OrderFlowError('rejected', `broadcast answered ${result.txId}, locally signed ${localTxId}`);
    }
    return { transaction, txId: localTxId };
  }

  /** Encoded legs for the fee/change model: order outputs size like their
   *  transfer counterparts at the M3 estimator convention (zero amounts). */
  function estimateLegs(outputs: EstimatedMlOutput[]): Promise<Uint8Array[]> {
    return Promise.all(
      outputs.map((leg) =>
        leg.kind === 'coin'
          ? b().encodeOutputTransfer('0', leg.address, cfg.network)
          : b().encodeOutputTokenTransfer(leg.tokenId ?? '', '0', leg.address, cfg.network),
      ),
    );
  }

  return {
    async createOrder({ giveTokenId, giveAtoms, askTokenId, askAtoms }) {
      return serialize(async () => {
        requireAtomAmount(giveAtoms);
        requireAtomAmount(askAtoms);
        const utxos = await fetchUtxos();
        const changeAddress = await cfg.allocateChangeAddress();
        try {
          const orderOutput = (giveAmount: string, askAmount: string): Promise<Uint8Array> =>
            b().encodeCreateOrderOutput({
              give: { tokenId: giveTokenId === COIN_REF ? 'coin' : giveTokenId, atoms: giveAmount },
              ask: { tokenId: askTokenId === COIN_REF ? 'coin' : askTokenId, atoms: askAmount },
              concludeDestination: changeAddress,
              network: cfg.network,
            });

          // Selection: the give leg funds the order output (coin or token),
          // the coin pool carries the fee; token remainders return to the
          // change address (selectMlInputs models exactly these legs).
          const rate = await cfg.indexer.feerate(STANDARD_TIER_IN_TOP_MB);
          const selection = await selectMlInputs({
            utxos,
            sendAtoms: giveAtoms,
            to: changeAddress,
            tokenId: giveTokenId === COIN_REF ? null : giveTokenId,
            rateAtomsPerKb: rate,
            sizeOf: async (inputs, planned) => {
              const inputBytes: Uint8Array[] = [];
              const destinations: string[] = [];
              for (const selected of inputs) {
                inputBytes.push(await utxoInput(selected));
                destinations.push(selected.address);
              }
              const outputBytes = [await orderOutput('0', '0'), ...(await estimateLegs(planned.slice(1)))];
              return b().estimateTransactionSize(inputBytes, destinations, outputBytes, cfg.network);
            },
          });

          const inputs: Uint8Array[] = [];
          for (const selected of selection.selection) inputs.push(await utxoInput(selected));
          const outputs: Uint8Array[] = [await orderOutput(giveAtoms, askAtoms)];
          if (giveTokenId !== COIN_REF) {
            const tokenSelected = selection.selection
              .filter((input) => input.tokenId === giveTokenId)
              .reduce((acc, input) => acc + BigInt(input.atoms), 0n);
            const tokenRemainder = tokenSelected - BigInt(giveAtoms);
            if (tokenRemainder > 0n) {
              outputs.push(await b().encodeOutputTokenTransfer(giveTokenId, tokenRemainder.toString(), changeAddress, cfg.network));
            }
          }
          if (selection.changeAtoms !== '0') {
            outputs.push(await b().encodeOutputTransfer(selection.changeAtoms, changeAddress, cfg.network));
          }

          const { txId } = await finish(inputs, outputs, selection.selection, new Map());
          // The order id derives from the create tx inputs through the
          // bindings (make_order_id(tx.inputs()), no output index).
          const orderId = await b().getOrderId(inputs, cfg.network);
          return { txId, orderId };
        } catch (e) {
          await cfg.releaseFailedChange();
          throw e;
        }
      });
    },

    async fillOrder({ orderId, fillAtoms, destination, priceBand }) {
      return serialize(async () => {
        requireAtomAmount(fillAtoms);
        const info = await cfg.indexer.order(orderId);
        const order = orderFromIndexer(info);
        if (orderPhase(order) !== 'open') throw new OrderFlowError('not-open');
        if (BigInt(fillAtoms) > BigInt(order.askBalanceAtoms)) throw new OrderFlowError('overbid');

        // Proportional give payout (V1 price on the original legs when the
        // indexer serves them, current balances on fully-unfilled orders).
        const giveLeg = BigInt(info.initiallyGiven?.atoms ?? order.giveBalanceAtoms);
        const askLeg = BigInt(info.initiallyAsked?.atoms ?? order.askBalanceAtoms);
        if (giveLeg <= 0n || askLeg <= 0n) throw new OrderFlowError('rejected', 'the order legs are not a usable price');
        const givePayout = ((giveLeg * BigInt(fillAtoms)) / askLeg).toString();

        // Effective fill price (ask units per give unit) from the fetched
        // order, re-checked against the book mid inside the user band
        // before any transaction is built: a stale or hostile book must
        // not silently price the fill.
        const effective = rationalDecimal(
          BigInt(fillAtoms) * 10n ** BigInt(priceBand.giveDecimals),
          BigInt(givePayout) * 10n ** BigInt(priceBand.askDecimals),
        );
        const band = checkSlippage({ limitDecimal: effective, midDecimal: priceBand.midDecimal, maxSlippagePct: priceBand.maxSlippagePct });
        if (!band.ok) {
          throw new OrderFlowError('slippage', `the effective fill price ${effective} sits past the ${priceBand.maxSlippagePct}% band around the mid ${priceBand.midDecimal}`);
        }

        const utxos = await fetchUtxos();
        const changeAddress = await cfg.allocateChangeAddress();
        try {
          const rate = await cfg.indexer.feerate(STANDARD_TIER_IN_TOP_MB);
          // Payer selection: the fill pays the ask currency into the order
          // (token leg or coin leg) and covers the fee in coin; the give
          // payout is released by the order itself through the fill input.
          const selection = await selectMlInputs({
            utxos,
            sendAtoms: fillAtoms,
            to: changeAddress,
            tokenId: order.askTokenId === COIN_REF ? null : order.askTokenId,
            rateAtomsPerKb: rate,
            sizeOf: async (inputs, planned) => {
              const inputBytes: Uint8Array[] = [];
              const destinations: string[] = [];
              for (const selected of inputs) {
                inputBytes.push(await utxoInput(selected));
                destinations.push(selected.address);
              }
              const outputBytes = await estimateLegs(planned);
              return b().estimateTransactionSize(inputBytes, destinations, outputBytes, cfg.network);
            },
          });

          // The fill input selects the orders V0/V1 form through the
          // account nonce and the current block height (bindings docs);
          // both come from the indexer tip plus the in-session counter.
          const fillInput = await b().encodeInputForFillOrder(
            orderId,
            fillAtoms,
            destination,
            accountNonce++,
            (await cfg.indexer.tip()).blockHeight,
            cfg.network,
          );
          const inputs: Uint8Array[] = [fillInput];
          for (const selected of selection.selection) inputs.push(await utxoInput(selected));

          const outputs: Uint8Array[] = [
            order.giveTokenId === COIN_REF
              ? await b().encodeOutputTransfer(givePayout, destination, cfg.network)
              : await b().encodeOutputTokenTransfer(order.giveTokenId, givePayout, destination, cfg.network),
          ];
          if (order.askTokenId !== COIN_REF) {
            const askSelected = selection.selection
              .filter((input) => input.tokenId === order.askTokenId)
              .reduce((acc, input) => acc + BigInt(input.atoms), 0n);
            const askRemainder = askSelected - BigInt(fillAtoms);
            if (askRemainder > 0n) {
              outputs.push(await b().encodeOutputTokenTransfer(order.askTokenId, askRemainder.toString(), changeAddress, cfg.network));
            }
          }
          if (selection.changeAtoms !== '0') {
            outputs.push(await b().encodeOutputTransfer(selection.changeAtoms, changeAddress, cfg.network));
          }

          const noSignature = await b().encodeWitnessNoSignature();
          return { txId: await finishTx(inputs, outputs, selection.selection, new Map([[0, noSignature]])) };
        } catch (e) {
          await cfg.releaseFailedChange();
          throw e;
        }
      });
    },

    async concludeOrder({ orderId }) {
      return serialize(async () => {
        const order = orderFromIndexer(await cfg.indexer.order(orderId));
        if (order.concludeDestination === '') throw new OrderFlowError('rejected', 'order has no conclude destination');
        // Maker-only: the conclude destination must be one of ours.
        const ours = new Set(await cfg.addresses());
        if (!ours.has(order.concludeDestination)) throw new OrderFlowError('not-mine');
        if (orderPhase(order) === 'concluded') throw new OrderFlowError('not-open');

        const utxos = await fetchUtxos();
        const changeAddress = await cfg.allocateChangeAddress();
        try {
          const rate = await cfg.indexer.feerate(STANDARD_TIER_IN_TOP_MB);
          // Fee-only coin selection: conclude reclaims the order balances
          // to the conclude destination and pays the fee from our inputs.
          const selection = await selectMlInputs({
            utxos,
            sendAtoms: '0',
            to: changeAddress,
            tokenId: null,
            rateAtomsPerKb: rate,
            sizeOf: async (inputs, planned) => {
              const inputBytes: Uint8Array[] = [];
              const destinations: string[] = [];
              for (const selected of inputs) {
                inputBytes.push(await utxoInput(selected));
                destinations.push(selected.address);
              }
              const outputBytes = await estimateLegs(planned);
              return b().estimateTransactionSize(inputBytes, destinations, outputBytes, cfg.network);
            },
          });

          const concludeInput = await b().encodeInputForConcludeOrder(
            orderId,
            accountNonce++,
            (await cfg.indexer.tip()).blockHeight,
            cfg.network,
          );
          const inputs: Uint8Array[] = [concludeInput];
          for (const selected of selection.selection) inputs.push(await utxoInput(selected));

          const outputs: Uint8Array[] = [];
          if (order.giveBalanceAtoms !== '0') {
            outputs.push(
              order.giveTokenId === COIN_REF
                ? await b().encodeOutputTransfer(order.giveBalanceAtoms, order.concludeDestination, cfg.network)
                : await b().encodeOutputTokenTransfer(order.giveTokenId, order.giveBalanceAtoms, order.concludeDestination, cfg.network),
            );
          }
          if (order.askBalanceAtoms !== '0') {
            outputs.push(
              order.askTokenId === COIN_REF
                ? await b().encodeOutputTransfer(order.askBalanceAtoms, order.concludeDestination, cfg.network)
                : await b().encodeOutputTokenTransfer(order.askTokenId, order.askBalanceAtoms, order.concludeDestination, cfg.network),
            );
          }
          if (selection.changeAtoms !== '0') {
            outputs.push(await b().encodeOutputTransfer(selection.changeAtoms, changeAddress, cfg.network));
          }

          const noSignature = await b().encodeWitnessNoSignature();
          return { txId: await finishTx(inputs, outputs, selection.selection, new Map([[0, noSignature]])) };
        } catch (e) {
          await cfg.releaseFailedChange();
          throw e;
        }
      });
    },

    async openOrders(base, quote) {
      const rows = await cfg.indexer.ordersByPair(base, quote);
      return rows.map(orderFromIndexer);
    },

    async myOrders() {
      const ours = new Set(await cfg.addresses());
      const rows = await cfg.indexer.orders();
      return rows.map(orderFromIndexer).filter((order) => ours.has(order.concludeDestination));
    },
  };

  /** Sign-and-broadcast variant for fill and conclude: same broadcast-id
   *  honesty contract as finish (a lying backend must not hand back an id
   *  that does not match the locally signed transaction). */
  async function finishTx(
    inputs: Uint8Array[],
    outputs: Uint8Array[],
    payerInputs: SelectedMlInput[],
    prebuiltWitnesses: Map<number, Uint8Array>,
  ): Promise<string> {
    const transaction = await b().encodeTransaction(inputs, outputs, 0);
    const localTxId = await b().getTransactionId(transaction, false);
    const tip = await cfg.indexer.tip();
    const signedHex = await cfg.withSession((session) => sign(transaction, payerInputs, prebuiltWitnesses, session, tip.blockHeight + 1));
    const result = await cfg.broadcast.broadcastMl(signedHex).catch((e: unknown) => {
      if (e instanceof BroadcastError && e.failure === 'disabled') {
        throw new OrderFlowError('broadcast-disabled');
      }
      throw e;
    });
    if (result.txId.toLowerCase() !== localTxId.toLowerCase()) {
      throw new OrderFlowError('rejected', `broadcast answered ${result.txId}, locally signed ${localTxId}`);
    }
    return localTxId;
  }
}

/** give * fill / ask on the given legs, floor division (BigInt mirror of
 *  mintlayer-core calculate_filled_amount). Exported for the confirm sheet
 *  to preview the payout before any transaction is built. */
export function proportionalGivePayout(giveLegAtoms: string, askLegAtoms: string, fillAtoms: string): string {
  return ((BigInt(giveLegAtoms) * BigInt(fillAtoms)) / BigInt(askLegAtoms)).toString();
}
