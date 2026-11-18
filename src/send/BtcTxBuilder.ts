// Bitcoin send pipeline (spec M3 deliverable 7): P2WPKH build and sign on
// the confirmed scure stack (decisions.md R2: @scure/bip32 + @scure/
// btc-signer, audited, pure TS, Hermes-safe) end to end real in the Node
// gate. Fees come from btc-api /fee-estimates through the injected rate
// source (tier buckets chosen by the caller); when the backend is not
// configured the injected source reports a fixed fallback and the plan
// flags it (rateIsFallback) so the UI can say the rate is a guess.
//
// Unconfirmed-input policy: external receipts are spendable only after they
// confirm (a mempool receipt can be RBF-replaced or evicted, which would
// invalidate a signed spend of it). The one deliberate exception is our own
// change: after send N the change output sits unconfirmed on branch 1, and
// refusing it would make back to back sends fail with typed insufficient
// funds while the balance display already counts it. UTXOs on a change
// (branch 1) address are therefore spendable while unconfirmed; they can
// only confirm or drop together with the transaction that created them.
//
// Secrets: the seed and every input private key exist only inside the
// caller's KeySession.withSeed closure (buildAndSign receives the seed);
// inputs are matched to derivation paths over the public account xpub, and
// nothing derived from the seed is cached or logged.
import { HDKey } from '@scure/bip32';
import { NETWORK, TEST_NETWORK, Transaction, p2wpkh, selectUTXO } from '@scure/btc-signer';

import { btcPrivateKeyFromSeed, type BtcBranch, type BtcNetwork } from '../keys/BtcKeyring';
import type { BtcChainService, BtcUtxo } from '../data/btc/BtcChainService';
import type { FeeTierId } from '../data/providers/types';
import { SendError } from './errors';

/** UTXO source seam: only the UTXO listing the builder consumes. */
export type BtcUtxoSource = Pick<BtcChainService, 'utxos'>;

/** Rate source seam: tier to sat/vB, with the fallback flag. */
export type BtcRateSource = (tier: FeeTierId) => Promise<{ satPerVbyte: number; fallback: boolean }>;

/** A reviewed rate pinned into the signing call (fee pinning): when set it
 *  replaces the live rate source so the signed fee is exactly the fee the
 *  user reviewed, never a fresh (possibly higher) estimate. */
export type BtcPinnedRate = { satPerVbyte: string; isFallback: boolean };

/** Parse a pinned rate string into the positive number the estimator uses. */
export function parsePinnedRate(satPerVbyte: string): number {
  const rate = Number(satPerVbyte);
  if (!Number.isFinite(rate) || rate <= 0) throw new SendError('rejected', 'reviewed fee rate is not a usable number');
  return rate;
}

/** Standard-relay dust floor for a P2WPKH output (claim input weight times
 *  the 3 sat/vB relay rate, rounded up): 294 sat. Sending less would create
 *  an output full nodes refuse to relay. */
export const BTC_DUST_SAT = 294n;

/** Walk bound for matching addresses to derivation paths when no counter
 *  source is injected: aligned with the AddressManager scan ceiling so the
 *  reachable-by-scan wallet indexes map. */
const ORIGIN_WALK_LIMIT = 512;

/** Headroom the origin walk adds over the injected persisted counters: it
 *  covers allocations made after the counter read (a serialized send can
 *  have advanced the change index moments earlier). */
const ORIGIN_WALK_HEADROOM = 16;

export type BtcFeePlan = {
  tier: FeeTierId;
  /** Rate used for sizing, sat per vbyte as a decimal string. */
  satPerVbyte: string;
  /** True when the rate came from the fixed fallback, not fee-estimates. */
  rateIsFallback: boolean;
  feeSat: string;
  vsize: number;
  inputSat: string;
  /** Zero when the remainder fell below dust and merged into the fee. */
  changeSat: string;
};

export type BtcSendResult = {
  hex: string;
  txid: string;
  feeSat: string;
  vsize: number;
  /** Amount that reached the recipient (equals the requested amount). */
  sentSat: string;
  rateSatPerVbyte: string;
  rateIsFallback: boolean;
};

type WalletOrigin = { branch: BtcBranch; index: number; script: Uint8Array };

export class BtcTxBuilder {
  private readonly net: typeof NETWORK | typeof TEST_NETWORK;

  constructor(
    private readonly opts: {
      network: BtcNetwork;
      utxos: BtcUtxoSource;
      rateSource: BtcRateSource;
      changeAddress: string;
      /** The persisted derivation counters (AddressManager.indexes): the
       *  origin walk extends past the fixed limit to every index the wallet
       *  may already have allocated, so change and older receiving UTXOs
       *  stay spendable after long send histories. Absent, the fixed walk
       *  limit applies. */
      walkCounters?: () => Promise<{ receiving: number; change: number }>;
    },
  ) {
    this.net = opts.network === 'mainnet' ? NETWORK : TEST_NETWORK;
  }

  /** Fee plan per tier for the current UTXO set (review screen). */
  async plan(params: {
    accountXpub: string;
    fromAddresses: string[];
    to: string;
    amountSat: bigint;
    tier: FeeTierId;
    pinnedRate?: BtcPinnedRate;
  }): Promise<BtcFeePlan> {
    const { tx, inputSat, weight, rate, fallback } = await this.buildUnsigned(params);
    const feeSat = tx.fee;
    return {
      tier: params.tier,
      satPerVbyte: rate.toString(),
      rateIsFallback: fallback,
      feeSat: feeSat.toString(),
      // Weight units to vsize (ceil/4): the estimator already counts the
      // witness marker weight, so the plan matches the signed vsize.
      vsize: Math.ceil(weight / 4),
      inputSat: inputSat.toString(),
      changeSat: (inputSat - params.amountSat - feeSat).toString(),
    };
  }

  /** Build, sign every input with the wallet's child keys, and return the
   *  raw signed transaction for BroadcastProvider.broadcastBtc. The seed
   *  argument must come from inside a KeySession.withSeed closure. Each
   *  selected input is signed with the child key of the address it pays:
   *  inputs may mix receiving and change origins across the wallet. */
  async buildAndSign(params: {
    seed: Uint8Array;
    accountXpub: string;
    fromAddresses: string[];
    to: string;
    amountSat: bigint;
    tier: FeeTierId;
    pinnedRate?: BtcPinnedRate;
  }): Promise<BtcSendResult> {
    const { tx, rate, fallback, inputOrigins } = await this.buildUnsigned(params);
    for (let index = 0; index < tx.inputsLength; index++) {
      const input = tx.getInput(index);
      if (input.txid === undefined || input.index === undefined) throw new SendError('rejected', 'selected input is missing its outpoint');
      const origin = inputOrigins.get(`${bytesToHex(input.txid)}:${input.index}`);
      if (origin === undefined) throw new SendError('rejected', 'selected input has no wallet origin');
      const privateKey = btcPrivateKeyFromSeed(params.seed, this.opts.network, origin.branch, origin.index);
      tx.signIdx(privateKey, index);
    }
    tx.finalize();
    return {
      hex: bytesToHex(tx.extract()),
      txid: tx.id,
      feeSat: tx.fee.toString(),
      vsize: tx.vsize,
      sentSat: params.amountSat.toString(),
      rateSatPerVbyte: rate.toString(),
      rateIsFallback: fallback,
    };
  }

  /** Shared selection: dust guard, rate resolution, UTXO fetch across the
   *  managed wallet addresses, public address to path mapping, scure
   *  selection with an auto change output. Inputs may come from any managed
   *  address, so the returned map keys every selected outpoint to the
   *  (branch, index) origin its address derives from. */
  private async buildUnsigned(params: {
    accountXpub: string;
    fromAddresses: string[];
    to: string;
    amountSat: bigint;
    tier: FeeTierId;
    pinnedRate?: BtcPinnedRate;
  }): Promise<{ tx: Transaction; inputSat: bigint; weight: number; rate: bigint; fallback: boolean; inputOrigins: Map<string, WalletOrigin> }> {
    if (!Array.isArray(params.fromAddresses)) {
      // Shape guard over the typed contract: a stale single-address caller
      // (the pre multi-address shape) must fail typed, never iterate an
      // undefined field.
      throw new SendError('rejected', 'fromAddresses must be an array of managed addresses');
    }
    if (params.amountSat < BTC_DUST_SAT) throw new SendError('dust', `${params.amountSat} sat is below dust`);
    let satPerVbyte: number;
    let fallback: boolean;
    if (params.pinnedRate !== undefined) {
      satPerVbyte = parsePinnedRate(params.pinnedRate.satPerVbyte);
      fallback = params.pinnedRate.isFallback;
    } else {
      ({ satPerVbyte, fallback } = await this.opts.rateSource(params.tier));
    }
    if (!(satPerVbyte > 0) || !Number.isFinite(satPerVbyte)) {
      throw new SendError('broadcast-failed', 'fee rate source answered an unusable value');
    }
    const rate = BigInt(Math.ceil(satPerVbyte));

    const origins = await this.walletOrigins(params.accountXpub);
    // Change and older receiving UTXOs are only reachable through the full
    // managed address list; funding on one address would strand the rest
    // (the balance display already sums every managed address).
    const inputOrigins = new Map<string, WalletOrigin>();
    const scureInputs: ReturnType<BtcTxBuilder['toScureInput']>[] = [];
    let managed = 0;
    for (const address of params.fromAddresses) {
      const origin = origins.get(address);
      if (origin === undefined) continue;
      managed++;
      for (const utxo of await this.opts.utxos.utxos(address)) {
        if (!utxo.confirmed && origin.branch !== 1) continue; // header policy: external receipts need a confirmation
        scureInputs.push(this.toScureInput(utxo, origin.script));
        inputOrigins.set(`${utxo.txid}:${utxo.vout}`, origin);
      }
    }
    if (managed === 0) throw new SendError('rejected', 'no managed wallet address was provided');
    if (scureInputs.length === 0) throw new SendError('insufficient-funds', 'no spendable UTXOs');
    let selection;
    try {
      selection = selectUTXO(scureInputs, [{ address: params.to, amount: params.amountSat }], 'default', {
        feePerByte: rate,
        changeAddress: this.opts.changeAddress,
        createTx: true,
        network: this.net,
      });
    } catch (e) {
      if (/not enough/i.test(e instanceof Error ? e.message : String(e))) {
        throw new SendError('insufficient-funds', 'UTXOs cannot cover the amount plus fee');
      }
      throw e;
    }
    if (selection === undefined || selection.tx === undefined) {
      throw new SendError('insufficient-funds', 'UTXOs cannot cover the amount plus fee');
    }
    const inputSat = selection.inputs.reduce((acc, input) => acc + (input.witnessUtxo?.amount ?? 0n), 0n);
    return { tx: selection.tx, inputSat, weight: selection.weight, rate, fallback, inputOrigins };
  }

  private originsCache: { xpub: string; receivingBound: number; changeBound: number; map: Map<string, WalletOrigin> } | null = null;

  /** Map wallet addresses to origins over the public account xpub: the
   *  receiving (0) and change (1) branches, each walked past the fixed
   *  limit when the injected persisted counters reach further. Public
   *  derivation only; no seed, no network. Memoized per xpub and bounds. */
  private async walletOrigins(accountXpub: string): Promise<Map<string, WalletOrigin>> {
    const counters = this.opts.walkCounters === undefined ? null : await this.opts.walkCounters();
    const boundOf = (counter: number): number => Math.max(ORIGIN_WALK_LIMIT, counter + ORIGIN_WALK_HEADROOM);
    const receivingBound = boundOf(counters === null ? 0 : counters.receiving);
    const changeBound = boundOf(counters === null ? 0 : counters.change);
    const cache = this.originsCache;
    if (cache !== null && cache.xpub === accountXpub && cache.receivingBound === receivingBound && cache.changeBound === changeBound) {
      return cache.map;
    }
    const account = HDKey.fromExtendedKey(accountXpub);
    const out = new Map<string, WalletOrigin>();
    for (const branch of [0, 1] as BtcBranch[]) {
      for (let index = 0; index < (branch === 0 ? receivingBound : changeBound); index++) {
        const child = account.derive(`m/${branch}/${index}`);
        if (child.publicKey === null) continue;
        const pay = p2wpkh(child.publicKey, this.net);
        if (pay.address !== undefined) out.set(pay.address, { branch, index, script: pay.script });
      }
    }
    this.originsCache = { xpub: accountXpub, receivingBound, changeBound, map: out };
    return out;
  }

  private toScureInput(utxo: BtcUtxo, script: Uint8Array): {
    txid: Uint8Array;
    index: number;
    witnessUtxo: { amount: bigint; script: Uint8Array };
  } {
    return {
      txid: hexToBytes(utxo.txid),
      index: utxo.vout,
      witnessUtxo: { amount: BigInt(utxo.valueSat), script },
    };
  }
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new SendError('rejected', 'utxo txid must be 64 hex chars');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}
