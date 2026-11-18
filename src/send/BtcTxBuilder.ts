// Bitcoin send pipeline (spec M3 deliverable 7): P2WPKH build and sign on
// the confirmed scure stack (decisions.md R2: @scure/bip32 + @scure/
// btc-signer, audited, pure TS, Hermes-safe) end to end real in the Node
// gate. Fees come from btc-api /fee-estimates through the injected rate
// source (tier buckets chosen by the caller); when the backend is not
// configured the injected source reports a fixed fallback and the plan
// flags it (rateIsFallback) so the UI can say the rate is a guess.
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

/** Standard-relay dust floor for a P2WPKH output (claim input weight times
 *  the 3 sat/vB relay rate, rounded up): 294 sat. Sending less would create
 *  an output full nodes refuse to relay. */
export const BTC_DUST_SAT = 294n;

/** Walk bound for matching addresses to derivation paths; aligned with the
 *  AddressManager scan ceiling so every reachable wallet index maps. */
const ORIGIN_WALK_LIMIT = 512;

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
    },
  ) {
    this.net = opts.network === 'mainnet' ? NETWORK : TEST_NETWORK;
  }

  /** Fee plan per tier for the current UTXO set (review screen). */
  async plan(params: { accountXpub: string; from: string; to: string; amountSat: bigint; tier: FeeTierId }): Promise<BtcFeePlan> {
    const { tx, inputSat, weight } = await this.buildUnsigned(params);
    const feeSat = tx.fee;
    return {
      tier: params.tier,
      satPerVbyte: this.currentRate.toString(),
      rateIsFallback: this.currentRateFallback,
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
   *  argument must come from inside a KeySession.withSeed closure. */
  async buildAndSign(params: {
    seed: Uint8Array;
    accountXpub: string;
    from: string;
    to: string;
    amountSat: bigint;
    tier: FeeTierId;
  }): Promise<BtcSendResult> {
    const { tx, rate, fallback, fromOrigin } = await this.buildUnsigned(params);
    for (let index = 0; index < tx.inputsLength; index++) {
      const privateKey = btcPrivateKeyFromSeed(params.seed, this.opts.network, fromOrigin.branch, fromOrigin.index);
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

  private currentRate = 1n;

  private currentRateFallback = false;

  /** Shared selection: dust guard, rate resolution, UTXO fetch, public
   *  address to path mapping, scure selection with an auto change output.
   *  One call spends one wallet address, so every selected input shares the
   *  `from` origin. */
  private async buildUnsigned(params: {
    accountXpub: string;
    from: string;
    to: string;
    amountSat: bigint;
    tier: FeeTierId;
  }): Promise<{ tx: Transaction; inputSat: bigint; weight: number; rate: bigint; fallback: boolean; fromOrigin: WalletOrigin }> {
    if (params.amountSat < BTC_DUST_SAT) throw new SendError('dust', `${params.amountSat} sat is below dust`);
    const { satPerVbyte, fallback } = await this.opts.rateSource(params.tier);
    if (!(satPerVbyte > 0) || !Number.isFinite(satPerVbyte)) {
      throw new SendError('broadcast-failed', 'fee rate source answered an unusable value');
    }
    const rate = BigInt(Math.ceil(satPerVbyte));
    this.currentRate = rate;
    this.currentRateFallback = fallback;

    const origins = await this.walletOrigins(params.accountXpub);
    const fromOrigin = origins.get(params.from);
    if (fromOrigin === undefined) throw new SendError('rejected', 'from address is not from this wallet');

    const utxos = await this.opts.utxos.utxos(params.from);
    if (utxos.length === 0) throw new SendError('insufficient-funds', 'no spendable UTXOs');
    const scureInputs = utxos.map((utxo) => this.toScureInput(utxo, fromOrigin.script));
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
    return { tx: selection.tx, inputSat, weight: selection.weight, rate, fallback, fromOrigin };
  }

  private originsCache: { xpub: string; map: Map<string, WalletOrigin> } | null = null;

  /** Map wallet addresses to origins over the public account xpub: the
   *  receiving (0) and change (1) branches up to the documented walk limit.
   *  Public derivation only; no seed, no network. Memoized per xpub. */
  private async walletOrigins(accountXpub: string): Promise<Map<string, WalletOrigin>> {
    if (this.originsCache !== null && this.originsCache.xpub === accountXpub) return this.originsCache.map;
    const account = HDKey.fromExtendedKey(accountXpub);
    const out = new Map<string, WalletOrigin>();
    for (const branch of [0, 1] as BtcBranch[]) {
      for (let index = 0; index < ORIGIN_WALK_LIMIT; index++) {
        const child = account.derive(`m/${branch}/${index}`);
        if (child.publicKey === null) continue;
        const pay = p2wpkh(child.publicKey, this.net);
        if (pay.address !== undefined) out.set(pay.address, { branch, index, script: pay.script });
      }
    }
    this.originsCache = { xpub: accountXpub, map: out };
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
