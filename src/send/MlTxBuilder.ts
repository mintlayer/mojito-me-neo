// Mintlayer transaction planner and assembler (spec M3 deliverable 4).
//
// Fee semantics follow the production pattern (project decision log F8):
// there is no explicit fee field, so fee = ceil(sizeBytes / 1000) *
// max(rate, 1) with the rate from GET /feerate (atoms per kB, in_top_x_mb
// selected by tier:
// economy 5, standard 1, fast 1; uplift multiplier 1 in v1). The size comes
// from bindings.estimateTransactionSize with one destination per input, so
// the implicit-fee invariant (sum inputs - sum outputs = fee) holds for
// every built transaction.
//
// Assembly and signing run over the MintlayerBindings interface
// (modules/mojito-core): the encoders are the bindings' job, never
// reimplemented here. On this machine and any device without the native
// call-through the bindings reject, which surfaces as the honest
// device-pending error, not a fallback to JS crypto.
//
// Selection is deterministic (largest first, grow until covered) and pure
// through the injected size estimator, so plan() and build() agree and the
// Node gate can test the whole pipeline offline against fixture UTXOs.
import { hex } from '@scure/base';

import type { MintlayerBindings, MlNetwork } from '../../modules/mojito-core';
import { atomsOf } from '../data/amount';
import { ML_DECIMALS } from '../money';
import type { FeeTierId } from '../data/providers/types';
import type { IndexerClient } from '../data/ml/IndexerClient';
import type { MlUtxo } from '../data/ml/types';
import { SendError } from './errors';

/** Indexer seam: only the two read routes the builder consumes (the tip
 *  read stays with realSend, which holds the full IndexerClient). */
export type MlChainReader = Pick<IndexerClient, 'spendableUtxos' | 'feerate'>;

/** GET /feerate window per tier (F8); the uplift multiplier stays 1 in v1. */
const TIER_IN_TOP_MB: Record<FeeTierId, number> = { economy: 5, standard: 1, fast: 1 };

/** One selected spendable: the UTXO plus the owner address it pays from. */
export type SelectedMlInput = {
  utxo: MlUtxo;
  address: string;
  atoms: string;
  /** null when this input carries coin (the fee carrier), else the token id. */
  tokenId: string | null;
};

/** Contract shape for the fee plan (spec M3 interface). */
export type MlFeePlan = {
  tier: FeeTierId;
  inputAtoms: string;
  sendAtoms: string;
  changeAtoms: string;
  feeAtoms: string;
  sizeBytes: number;
  rateAtomsPerKb: string;
};

/** plan() result: the contract plan plus the selection it was computed on,
 *  so build() signs exactly what was reviewed (no silent re-selection).
 *  Money fields are coin legs: inputAtoms and changeAtoms count coin only,
 *  so inputAtoms - changeAtoms = feeAtoms always holds, and for a coin send
 *  inputAtoms - sendAtoms - changeAtoms = feeAtoms. Token legs are visible
 *  in the selection and return their own remainder to the change address. */
export type MlPlanResult = MlFeePlan & { selection: SelectedMlInput[]; tokenId: string | null };

export type MlTxInput = {
  sourceId: string;
  index: number;
  address: string;
  atoms: string;
  tokenId: string | null;
  /** Re-encoded spent output, one per input, for bindings.encodeWitness. */
  outputBytes: Uint8Array;
};

export type UnsignedMlTx = {
  transaction: Uint8Array;
  txId: string;
  inputs: MlTxInput[];
  network: MlNetwork;
};

/** F8 fee rule on BigInt atom strings: ceil(bytes / 1000) * max(rate, 1). */
export function mlFeeAtoms(sizeBytes: number, rateAtomsPerKb: string): string {
  const kbCeil = BigInt(Math.max(1, Math.ceil(sizeBytes / 1000)));
  const rate = BigInt(/^\d+$/.test(rateAtomsPerKb) ? rateAtomsPerKb : '0');
  return (kbCeil * (rate > 1n ? rate : 1n)).toString();
}

function outputValue(utxo: MlUtxo): { kind: 'coin' | 'token'; atoms: string; tokenId: string | null } | null {
  const out = utxo.output;
  if (out.type !== 'Transfer' || out.destination === undefined || out.value === undefined) return null;
  const amount = out.value.amount;
  if (amount === undefined) return null;
  if (out.value.type === 'Coin') return { kind: 'coin', atoms: atomsOf(amount, ML_DECIMALS), tokenId: null };
  const tokenId = out.value.tokenId ?? out.tokenId ?? null;
  if (tokenId !== null) return { kind: 'token', atoms: atomsOf(amount, ML_DECIMALS), tokenId };
  return null;
}

function sumAtoms(list: SelectedMlInput[]): string {
  return list.reduce((acc, input) => (BigInt(acc) + BigInt(input.atoms)).toString(), '0');
}

/** Largest first, then input order: deterministic and fee-minimizing. */
function byAtomsDesc(a: SelectedMlInput, b: SelectedMlInput): number {
  const diff = BigInt(b.atoms) - BigInt(a.atoms);
  return diff === 0n ? 0 : diff > 0n ? 1 : -1;
}

/** One planned output the estimator must model: a coin transfer or a token
 *  transfer with its token id. Change legs ride the recipient address as a
 *  stand-in (every wallet address is the same pubkeyhash variant, so the
 *  encoded length is identical) and amounts encode as 0 per the estimator
 *  seam's contract. Sizing must match build()'s output list exactly or the
 *  implicit fee underbills the real transaction. */
export type EstimatedMlOutput = { kind: 'coin' | 'token'; address: string; tokenId?: string };

export type MlSelection = {
  selection: SelectedMlInput[];
  inputAtoms: string;
  changeAtoms: string;
  feeAtoms: string;
  sizeBytes: number;
};

/**
 * Grow the candidate set (value inputs first, then coin inputs for the fee
 * when a token is sent) until inputs cover send + fee, sizing honestly with
 * the real output list (recipient leg, token remainder leg when one
 * survives, coin change leg when a remainder survives). Throws the typed
 * insufficient-funds error when the pools cannot cover the spend.
 */
export async function selectMlInputs(opts: {
  utxos: MlUtxo[];
  sendAtoms: string;
  to: string;
  tokenId: string | null;
  sizeOf: (inputs: SelectedMlInput[], outputs: EstimatedMlOutput[]) => Promise<number>;
  rateAtomsPerKb: string;
}): Promise<MlSelection> {
  const valueKind = opts.tokenId === null ? 'coin' : 'token';
  const pools: { value: SelectedMlInput[]; fee: SelectedMlInput[] } = { value: [], fee: [] };
  for (const utxo of opts.utxos) {
    const value = outputValue(utxo);
    if (value === null) continue; // timelock, HTLC and issue outputs are not spendable by this builder
    const entry: SelectedMlInput = { utxo, address: utxo.output.destination ?? '', atoms: value.atoms, tokenId: value.tokenId };
    if (value.kind === valueKind && (valueKind === 'coin' || value.tokenId === opts.tokenId)) {
      pools.value.push(entry);
    } else if (value.kind === 'coin' && valueKind === 'token') {
      pools.fee.push(entry);
    }
  }
  if (pools.value.length === 0 || (valueKind === 'token' && pools.fee.length === 0)) {
    throw new SendError('insufficient-funds', 'no spendable outputs for this asset');
  }
  pools.value.sort(byAtomsDesc);
  pools.fee.sort(byAtomsDesc);

  /** The exact output list build() will emit for this selection: the
   *  recipient leg, the token remainder as its own token transfer when the
   *  indivisible token inputs overshoot the send, and the coin change when
   *  a remainder survives. A token remainder modeled as a plain transfer
   *  (or not at all) underbills the fee and the broadcast gets rejected. */
  const plannedOutputs = (inputs: SelectedMlInput[], changePresent: boolean): EstimatedMlOutput[] => {
    const outs: EstimatedMlOutput[] = [
      valueKind === 'coin' ? { kind: 'coin', address: opts.to } : { kind: 'token', address: opts.to, tokenId: opts.tokenId ?? undefined },
    ];
    if (valueKind === 'token') {
      const tokenSelected = inputs
        .filter((input) => input.tokenId === opts.tokenId)
        .reduce((acc, input) => acc + BigInt(input.atoms), 0n);
      if (tokenSelected - BigInt(opts.sendAtoms) > 0n) {
        outs.push({ kind: 'token', address: opts.to, tokenId: opts.tokenId ?? undefined });
      }
    }
    if (changePresent) outs.push({ kind: 'coin', address: opts.to });
    return outs;
  };

  const sizeWithFee = async (inputs: SelectedMlInput[], changePresent: boolean): Promise<{ size: number; fee: string }> => {
    const size = await opts.sizeOf(inputs, plannedOutputs(inputs, changePresent));
    return { size, fee: mlFeeAtoms(size, opts.rateAtomsPerKb) };
  };

  /** Cover check with change-aware sizing (adding the change output grows
   *  the size, so the fee is settled in a second pass per prefix). Only the
   *  coin legs fund the spend-side arithmetic: a token send consumes token
   *  inputs for the value and coin inputs for the fee alone. */
  const coinOnly = opts.tokenId === null ? BigInt(opts.sendAtoms) : 0n;
  const cover = async (inputs: SelectedMlInput[]): Promise<MlSelection | null> => {
    let changePresent = false;
    for (let pass = 0; pass < 3; pass++) {
      const { size, fee } = await sizeWithFee(inputs, changePresent);
      const total = BigInt(sumAtoms(inputs.filter((input) => input.tokenId === null)));
      const change = total - coinOnly - BigInt(fee);
      const needsChange = change > 0n;
      if (needsChange === changePresent) {
        if (change < 0n) return null;
        return { selection: inputs, inputAtoms: total.toString(), changeAtoms: change.toString(), feeAtoms: fee, sizeBytes: size };
      }
      changePresent = needsChange;
    }
    return null;
  };

  // Value pool prefixes; for token sends the coin pool covers the fee.
  if (valueKind === 'coin') {
    for (let k = 1; k <= pools.value.length; k++) {
      const result = await cover(pools.value.slice(0, k));
      if (result !== null) return result;
    }
  } else {
    for (let v = 1; v <= pools.value.length; v++) {
      const valueInputs = pools.value.slice(0, v);
      const valueSum = sumAtoms(valueInputs);
      if (BigInt(valueSum) < BigInt(opts.sendAtoms)) continue;
      for (let f = 1; f <= pools.fee.length; f++) {
        const result = await cover([...valueInputs, ...pools.fee.slice(0, f)]);
        if (result !== null) return result;
      }
    }
  }
  const available = sumAtoms([...pools.value, ...pools.fee]);
  throw new SendError('insufficient-funds', `need ${opts.sendAtoms} atoms, spendable ${available}`);
}

export class MlTxBuilder {
  constructor(
    private readonly bindings: MintlayerBindings,
    private readonly indexer: MlChainReader,
    private readonly network: MlNetwork,
  ) {}

  /** Fee plan per tier against live UTXOs and the live feerate. */
  async plan(params: {
    fromAddresses: string[];
    to: string;
    amountAtoms: string;
    tier: FeeTierId;
    tokenId?: string;
    utxos?: MlUtxo[];
  }): Promise<MlPlanResult> {
    const rateAtomsPerKb = await this.indexer.feerate(TIER_IN_TOP_MB[params.tier]);
    const utxos = params.utxos ?? (await this.fetchUtxos(params.fromAddresses));
    const selection = await selectMlInputs({
      utxos,
      sendAtoms: params.amountAtoms,
      to: params.to,
      tokenId: params.tokenId ?? null,
      rateAtomsPerKb,
      sizeOf: (inputs, outputs) => this.estimateSize(inputs, outputs),
    });
    return {
      tier: params.tier,
      inputAtoms: sumAtoms(selection.selection),
      sendAtoms: params.amountAtoms,
      changeAtoms: selection.changeAtoms,
      feeAtoms: selection.feeAtoms,
      sizeBytes: selection.sizeBytes,
      rateAtomsPerKb,
      selection: selection.selection,
      tokenId: params.tokenId ?? null,
    };
  }

  /** Assemble the unsigned transaction for the reviewed plan. The change
   *  address comes from the caller (AddressManager branch 1). The contract's
   *  fromAddresses parameter is dropped deliberately: the selection rides in
   *  the plan result, so review and build can never diverge and no stale
   *  address list can reintroduce a silent re-selection. */
  async build(params: MlPlanResult & { to: string; changeAddress: string }): Promise<UnsignedMlTx> {
    if (params.selection.length === 0) throw new SendError('rejected', 'plan selection is empty');
    const inputs: Uint8Array[] = [];
    for (const selected of params.selection) {
      const sourceId = hex.decode(selected.utxo.outpoint.sourceId);
      if (sourceId.length !== 32) throw new SendError('rejected', 'outpoint source id must be 32 bytes');
      const outpointSource = await this.bindings.encodeOutpointSourceId(
        sourceId,
        selected.utxo.outpoint.sourceType === 'BlockReward' ? 'block-reward' : 'transaction',
      );
      inputs.push(await this.bindings.encodeInputForUtxo(outpointSource, selected.utxo.outpoint.index));
    }
    const outputs: Uint8Array[] = [];
    if (params.tokenId === null) {
      outputs.push(await this.bindings.encodeOutputTransfer(params.sendAtoms, params.to, this.network));
    } else {
      outputs.push(await this.bindings.encodeOutputTokenTransfer(params.tokenId, params.sendAtoms, params.to, this.network));
      // UTXOs are indivisible: when the selected token inputs exceed the
      // send amount, the remainder returns to the change address as its own
      // token transfer output (per-asset conservation; the fee invariant
      // stays on the coin legs).
      const tokenSelected = params.selection
        .filter((input) => input.tokenId === params.tokenId)
        .reduce((acc, input) => acc + BigInt(input.atoms), 0n);
      const tokenChange = tokenSelected - BigInt(params.sendAtoms);
      if (tokenChange > 0n) {
        outputs.push(await this.bindings.encodeOutputTokenTransfer(params.tokenId, tokenChange.toString(), params.changeAddress, this.network));
      }
    }
    if (params.changeAtoms !== '0') {
      outputs.push(await this.bindings.encodeOutputTransfer(params.changeAtoms, params.changeAddress, this.network));
    }
    const transaction = await this.bindings.encodeTransaction(inputs, outputs, 0);
    const txId = await this.bindings.getTransactionId(transaction, false);
    const txInputs: MlTxInput[] = [];
    for (const selected of params.selection) {
      const outputBytes =
        selected.tokenId === null
          ? await this.bindings.encodeOutputTransfer(selected.atoms, selected.address, this.network)
          : await this.bindings.encodeOutputTokenTransfer(selected.tokenId, selected.atoms, selected.address, this.network);
      txInputs.push({
        sourceId: selected.utxo.outpoint.sourceId,
        index: selected.utxo.outpoint.index,
        address: selected.address,
        atoms: selected.atoms,
        tokenId: selected.tokenId,
        outputBytes,
      });
    }
    return { transaction, txId, inputs: txInputs, network: this.network };
  }

  private async fetchUtxos(fromAddresses: string[]): Promise<MlUtxo[]> {
    // Sequential per address, mirroring the M2 scanning note: one
    // request per address, no fan-out against the public indexer.
    const lists: MlUtxo[] = [];
    for (const address of fromAddresses) lists.push(...(await this.indexer.spendableUtxos(address)));
    return lists;
  }

  /** F8 sizing over the real output list: one destination (the owning
   *  address) per input, then the planned outputs rebuilt through the same
   *  encoders build() uses, so the token remainder bills as a token
   *  transfer and the coin change as a transfer. */
  private async estimateSize(inputs: SelectedMlInput[], outputs: EstimatedMlOutput[]): Promise<number> {
    const inputBytes: Uint8Array[] = [];
    const destinations: string[] = [];
    for (const selected of inputs) {
      const outpointSource = await this.bindings.encodeOutpointSourceId(
        hex.decode(selected.utxo.outpoint.sourceId),
        selected.utxo.outpoint.sourceType === 'BlockReward' ? 'block-reward' : 'transaction',
      );
      inputBytes.push(await this.bindings.encodeInputForUtxo(outpointSource, selected.utxo.outpoint.index));
      destinations.push(selected.address);
    }
    const outputBytes: Uint8Array[] = [];
    for (const out of outputs) {
      outputBytes.push(
        out.kind === 'coin'
          ? await this.bindings.encodeOutputTransfer('0', out.address, this.network)
          : await this.bindings.encodeOutputTokenTransfer(out.tokenId ?? '', '0', out.address, this.network),
      );
    }
    return this.bindings.estimateTransactionSize(inputBytes, destinations, outputBytes, this.network);
  }
}
