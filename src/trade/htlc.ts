// ML-side HTLC lifecycle (spec M4 deliverable 3, F10 atomic swap model):
// lock Mintlayer with the secret hash, claim by revealing the preimage,
// refund after the timelock, and extract a revealed secret from a signed
// claim transaction. The counterparty BTC side is the demo counterpart
// (scripts/e2e-testnet.mjs documents the scripted flow); this module owns
// the Mintlayer legs.
//
// Secret handling (spec security note): the preimage is generated with
// MojitoCore.secureRandom by the caller (createSwapSecret), held in memory
// inside the session closure and never persisted and never logged; only
// SHA-256(secret) crosses the wire and storage. TIMELOCK_RULE records the
// F10 ordering (the BTC timelock must be shorter than the ML one); the
// guard call returns with real offer entry, which supplies the BTC leg
// the demo path had to fabricate (plans/mojito-neo/decisions.md).
//
// Honest states: every transaction assembles and signs through the
// MintlayerBindings seam, so without the native call-through the flows
// reject with the device-pending bindings error, never a fabricated
// success.
import { hex as hexOf } from '@scure/base';
import { bytesToHex } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';

import type { HtlcParams, MintlayerBindings, MlNetwork } from '../../modules/mojito-core';
import type { IndexerClient } from '../data/ml/IndexerClient';
import type { BroadcastProvider } from '../data/providers/types';
import type { MlTransaction } from '../data/ml/types';
import type { KeySession } from '../keys/session';
import { mlAddressAt, mlPrivateKeyFromSeed, mlXpubFromSeed, type MlBranch } from '../keys/mlAccounts';
import { selectMlInputs } from '../send/MlTxBuilder';
import { BroadcastError } from '../data/providers/BroadcastProvider';

/** F10: the Bitcoin timelock must be shorter than the Mintlayer one. */
export const TIMELOCK_RULE = 'btc timelock must be shorter than the mintlayer timelock (F10)';

export type HtlcOffer = {
  role: 'initiator' | 'counterparty';
  giveChain: 'ml' | 'btc';
  giveAtoms: string;
  wantAtoms: string;
  /** SHA-256 of the preimage; the preimage itself never rides an offer. */
  secretHash: Uint8Array;
  timelockSeconds: number;
};

/** Counterparty spend path (the address only: the vendored
 *  encodeOutputHtlc carries no spend pubkey, so a key here would be a
 *  fabricated field no consumer reads). */
export type HtlcSpend = { address: string };

/** The signed-but-unbroadcast lock transaction as initiate answers it: the
 *  opaque carrier between the build+sign and broadcast steps. The caller
 *  persists lockTx with the swap session (state 'offered') between the two
 *  steps, so the bytes are at rest before anything leaves the wallet. */
export type PreparedLock = {
  /** Locally computed lock transaction id (the HTLC outpoint id). */
  txId: string;
  /** Unsigned lock transaction bytes: the claim and refund decodes
   *  consume them, and the session record must persist them. */
  lockTx: Uint8Array;
  /** Signed lock transaction hex for broadcastLock. */
  signedLockHex: string;
  htlcOutpoint: { id: Uint8Array; index: number };
};

export interface HtlcFlows {
  /** Build and sign the lock transaction WITHOUT broadcasting (the first
   *  half of the initiate contract): the answer carries the unsigned lock
   *  bytes, the locally computed tx id and the signed hex for
   *  broadcastLock. The claim and refund decodes consume the bytes,
   *  because the public Mintlayer indexer serves no raw transaction route,
   *  so the caller MUST persist them with the swap session (state
   *  'offered') before calling broadcastLock: bytes at rest before the
   *  broadcast, or a crash after it strands the refund leg. */
  initiate(offer: HtlcOffer, spend: HtlcSpend, refundAddress: string): Promise<PreparedLock>;
  /** Broadcast the prepared lock (the second half): verifies the answered
   *  id against the locally computed one (M3 contract) and returns it. The
   *  caller transitions the session offered -> locked on success. */
  broadcastLock(prepared: PreparedLock): Promise<{ txId: string }>;
  /** Spend an HTLC with the revealed secret (the counterparty claim leg).
   *  lockTx carries the unsigned lock transaction bytes captured at
   *  initiate (not the tx id: the bindings decode consumes bytes). */
  claim(lockTx: Uint8Array, secret: Uint8Array, spend: HtlcSpend): Promise<{ txId: string }>;
  /** Reclaim after the timelock expiry (refund path, single sig). lockTx
   *  carries the unsigned lock transaction bytes captured at initiate. */
  refund(lockTx: Uint8Array): Promise<{ txId: string }>;
  /** Extract a revealed preimage from a signed claim transaction. The raw
   *  bytes come from the caller: the public Mintlayer indexer serves no raw
   *  transaction route, so a txId-only signature cannot honestly fetch what
   *  the bindings extraction consumes (the demo script and the BTC claim
   *  path both carry the bytes; see scripts/e2e-testnet.mjs). */
  extractSecret(rawSignedTx: Uint8Array, htlcOutpoint: { id: Uint8Array; index: number }): Promise<Uint8Array>;
}

export type HtlcFlowsConfig = {
  network: MlNetwork;
  /** The bindings facade loader (MojitoCore): a thunk because the facade
   *  pulls the native bridge, which the Node gate must not load (the
   *  realSend config carries the same lazy seam). */
  loadBindings: () => MintlayerBindings;
  indexer: Pick<IndexerClient, 'transaction' | 'feerate' | 'spendableUtxos' | 'tip'>;
  broadcast: BroadcastProvider;
  addresses: () => Promise<string[]>;
  allocateChangeAddress: () => Promise<string>;
  releaseFailedChange: () => Promise<void>;
  withSession: <T>(fn: (session: KeySession) => Promise<T>) => Promise<T>;
};

const STANDARD_TIER_IN_TOP_MB = 1;
const ORIGIN_WALK_LIMIT = 512;

export class HtlcError extends Error {
  constructor(
    readonly reason: 'rejected' | 'busy' | 'not-expired' | 'no-htlc-output' | 'broadcast-disabled',
    detail?: string,
  ) {
    super(detail ?? `htlc flow rejected: ${reason}`);
    this.name = 'HtlcError';
  }
}

export type HtlcDescriptor = {
  txId: string;
  outputIndex: number;
  atoms: string;
  secretHash: Uint8Array;
  spendAddress: string;
  refundAddress: string;
  refundTimelock: number;
};

export function createHtlcFlows(cfg: HtlcFlowsConfig): HtlcFlows {
  let bindings: MintlayerBindings | null = null;
  function b(): MintlayerBindings {
    if (bindings === null) bindings = cfg.loadBindings();
    return bindings;
  }
  let inFlight = false;
  function serialize<T>(fn: () => Promise<T>): Promise<T> {
    if (inFlight) return Promise.reject(new HtlcError('busy'));
    inFlight = true;
    return fn().finally(() => {
      inFlight = false;
    });
  }

  function requireAtomAmount(value: string): string {
    if (!/^\d+$/.test(value) || BigInt(value) === 0n) throw new HtlcError('rejected', 'amount must be a positive atom string');
    return value;
  }

  async function fetchUtxos() {
    const lists = [];
    for (const address of await cfg.addresses()) lists.push(...(await cfg.indexer.spendableUtxos(address)));
    return lists;
  }

  async function utxoInput(sourceIdHex: string, index: number): Promise<Uint8Array> {
    const sourceId = hexOf.decode(sourceIdHex);
    if (sourceId.length !== 32) throw new HtlcError('rejected', 'outpoint source id must be 32 bytes');
    const outpointSource = await b().encodeOutpointSourceId(sourceId, 'transaction');
    return b().encodeInputForUtxo(outpointSource, index);
  }

  async function sign(
    transaction: Uint8Array,
    inputs: { address: string }[],
    spentOutputs: Uint8Array[],
    session: KeySession,
    inclusionHeight: number,
  ): Promise<string> {
    return session.withSeed(async (seed) => {
      const { xpub } = mlXpubFromSeed(seed, cfg.network as 'mainnet' | 'testnet');
      const witnesses: Uint8Array[] = [];
      for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
        const origin = await resolveOrigin(xpub, inputs[inputIndex].address);
        const privateKey = mlPrivateKeyFromSeed(seed, cfg.network as 'mainnet' | 'testnet', origin.branch, origin.index);
        witnesses.push(
          await b().encodeWitness({
            sighashType: 'all' as const,
            privateKey,
            address: inputs[inputIndex].address,
            transaction,
            inputUtxos: spentOutputs,
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
    throw new HtlcError('rejected', 'input address does not derive from this wallet');
  }

  /** Broadcast with the M3 id-match contract: a lying backend must not
   *  hand back an id that does not match the locally signed transaction. */
  async function broadcast(transaction: Uint8Array, signedHex: string): Promise<string> {
    const localTxId = await b().getTransactionId(transaction, false);
    try {
      const result = await cfg.broadcast.broadcastMl(signedHex);
      if (result.txId.toLowerCase() !== localTxId.toLowerCase()) {
        throw new HtlcError('rejected', `broadcast answered ${result.txId}, locally signed ${localTxId}`);
      }
      return localTxId;
    } catch (e) {
      if (e instanceof BroadcastError && e.failure === 'disabled') throw new HtlcError('broadcast-disabled');
      throw e;
    }
  }

  /** Describe an on-chain HTLC output through the bindings decode seam:
   *  lockTx is the unsigned lock transaction captured at initiate (the
   *  bindings decode consumes serialized transaction bytes, never a tx id,
   *  and the indexer exposes no raw-tx route to fetch them later). The
   *  decode restores the lock parameters the claim and refund legs must
   *  rebuild; bindings stub rejections surface as the honest
   *  device-pending state, never a guessed descriptor. */
  async function describeHtlc(lockTx: Uint8Array): Promise<HtlcDescriptor> {
    const htlcTxId = await b().getTransactionId(lockTx, false);
    let tx: MlTransaction;
    try {
      tx = await cfg.indexer.transaction(htlcTxId);
    } catch {
      throw new HtlcError('no-htlc-output', `htlc transaction ${htlcTxId} is not readable`);
    }
    const outputIndex = tx.outputs.findIndex((output: { type: string }) => output.type === 'Htlc');
    if (outputIndex < 0) throw new HtlcError('no-htlc-output', `transaction ${htlcTxId} carries no HTLC output`);
    const json = await b().decodeTransactionToJson(lockTx, cfg.network);
    const parsed = JSON.parse(json) as {
      outputs?: { htlc?: { atoms?: string; secret_hash?: string; spend_address?: string; refund_address?: string; refund_timelock?: number } }[];
    };
    const htlc = parsed.outputs?.[outputIndex]?.htlc;
    if (!htlc?.atoms || htlc.secret_hash === undefined || htlc.spend_address === undefined) {
      throw new HtlcError('no-htlc-output', 'the bindings decode did not restore the lock parameters');
    }
    return {
      txId: htlcTxId,
      outputIndex,
      atoms: htlc.atoms,
      secretHash: hexOf.decode(htlc.secret_hash),
      spendAddress: htlc.spend_address,
      refundAddress: htlc.refund_address ?? '',
      refundTimelock: htlc.refund_timelock ?? 0,
    };
  }

  /** HtlcParams for the vendored encodeOutputHtlc shape: the secret hash
   *  rides hex, the refund timelock rides the encodeLockForSeconds blob
   *  (offers are seconds-denominated, F10). */
  async function htlcOutputParams(amount: string, secretHashBytes: Uint8Array, spendAddress: string, refundAddress: string, timelockSeconds: number): Promise<HtlcParams> {
    return {
      amount,
      secretHash: bytesToHex(secretHashBytes),
      spendAddress,
      refundAddress,
      refundTimelock: await b().encodeLockForSeconds(timelockSeconds),
    };
  }

  return {
    async initiate({ giveAtoms, secretHash, timelockSeconds }, spend, refundAddress) {
      return serialize(async () => {
        requireAtomAmount(giveAtoms);
        if (secretHash.length !== 32) throw new HtlcError('rejected', 'the secret hash must be 32 bytes (SHA-256)');
        if (!Number.isInteger(timelockSeconds) || timelockSeconds <= 0) throw new HtlcError('rejected', 'the refund timelock must be a positive second count');
        const utxos = await fetchUtxos();
        const changeAddress = await cfg.allocateChangeAddress();
        try {
          const rate = await cfg.indexer.feerate(STANDARD_TIER_IN_TOP_MB);
          const lockParams = async (atoms: string) => htlcOutputParams(atoms, secretHash, spend.address, refundAddress, timelockSeconds);
          const selection = await selectMlInputs({
            utxos,
            sendAtoms: giveAtoms,
            to: changeAddress,
            tokenId: null,
            rateAtomsPerKb: rate,
            sizeOf: async (inputs, planned) => {
              const inputBytes: Uint8Array[] = [];
              const destinations: string[] = [];
              for (const selected of inputs) {
                inputBytes.push(await utxoInput(selected.utxo.outpoint.sourceId, selected.utxo.outpoint.index));
                destinations.push(selected.address);
              }
              const outputBytes: Uint8Array[] = [
                await b().encodeOutputHtlc(await lockParams('0')),
                ...(await Promise.all(
                  planned.slice(1).map((leg) => b().encodeOutputTransfer('0', leg.address, cfg.network)),
                )),
              ];
              return b().estimateTransactionSize(inputBytes, destinations, outputBytes, cfg.network);
            },
          });

          const inputs: Uint8Array[] = [];
          const spentOutputs: Uint8Array[] = [];
          for (const selected of selection.selection) {
            inputs.push(await utxoInput(selected.utxo.outpoint.sourceId, selected.utxo.outpoint.index));
            spentOutputs.push(
              selected.tokenId === null
                ? await b().encodeOutputTransfer(selected.atoms, selected.address, cfg.network)
                : await b().encodeOutputTokenTransfer(selected.tokenId, selected.atoms, selected.address, cfg.network),
            );
          }
          const outputs: Uint8Array[] = [await b().encodeOutputHtlc(await lockParams(giveAtoms))];
          if (selection.changeAtoms !== '0') {
            outputs.push(await b().encodeOutputTransfer(selection.changeAtoms, changeAddress, cfg.network));
          }

          const transaction = await b().encodeTransaction(inputs, outputs, 0);
          const tip = await cfg.indexer.tip();
          const signedHex = await cfg.withSession((session) => sign(transaction, selection.selection, spentOutputs, session, tip.blockHeight + 1));
          // First half only: the tx id is computed locally (the same
          // getTransactionId the broadcast step verifies against) and the
          // broadcast waits for broadcastLock, after the caller has the
          // lock bytes at rest in the session record.
          const txId = await b().getTransactionId(transaction, false);
          // The HTLC outpoint rides the locally computed lock tx id and its
          // output index (the HTLC output is assembled at index 0 of this
          // flow), never the backend's answer.
          return { txId, lockTx: transaction, signedLockHex: signedHex, htlcOutpoint: { id: hexOf.decode(txId), index: 0 } };
        } catch (e) {
          await cfg.releaseFailedChange();
          throw e;
        }
      });
    },

    async broadcastLock(prepared) {
      return serialize(async () => {
        if (prepared.lockTx.length === 0 || prepared.signedLockHex.length === 0) {
          throw new HtlcError('rejected', 'the prepared lock carries no transaction');
        }
        try {
          return { txId: await broadcast(prepared.lockTx, prepared.signedLockHex) };
        } catch (e) {
          // A refused broadcast never spent the inputs: the change
          // allocation steps back like any failed attempt.
          await cfg.releaseFailedChange();
          throw e;
        }
      });
    },

    async claim(lockTx, secret, spend) {
      return serialize(async () => {
        if (secret.length !== 32) throw new HtlcError('rejected', 'the preimage must be 32 bytes');
        const descriptor = await describeHtlc(lockTx);
        const fee = await claimFee(descriptor.txId, descriptor.outputIndex, spend.address);
        const payout = BigInt(descriptor.atoms) - fee;
        if (payout <= 0n) throw new HtlcError('rejected', 'the lock cannot cover the claim fee');
        const htlcInput = await utxoInput(descriptor.txId, descriptor.outputIndex);
        const htlcOutputBytes = await b().encodeOutputHtlc(
          await htlcOutputParams(descriptor.atoms, descriptor.secretHash, descriptor.spendAddress, descriptor.refundAddress, descriptor.refundTimelock),
        );
        const inputs = [htlcInput];
        const outputs = [await b().encodeOutputTransfer(payout.toString(), spend.address, cfg.network)];
        const transaction = await b().encodeTransaction(inputs, outputs, 0);
        const tip = await cfg.indexer.tip();
        // The HTLC spend witness signs against the HTLC output (the spent
        // output of the single input) and reveals the preimage (F10).
        const signedHex = await cfg.withSession((session) =>
          signWithKey(transaction, spend.address, [htlcOutputBytes], session, tip.blockHeight + 1, secret, 'htlc-spend'),
        );
        return { txId: await broadcast(transaction, signedHex) };
      });
    },

    async refund(lockTx) {
      return serialize(async () => {
        const descriptor = await describeHtlc(lockTx);
        // Refunds unlock at the timelock expiry; the lock timestamp plus
        // the timelock must already be in the past, otherwise the refund
        // would be rejected by the chain: honest typed refusal first.
        const tx = await cfg.indexer.transaction(descriptor.txId);
        const lockedAt = tx.timestamp ?? 0;
        if (lockedAt + descriptor.refundTimelock > Math.floor(Date.now() / 1000)) {
          throw new HtlcError('not-expired', 'the refund unlocks after the timelock expiry');
        }
        const fee = await claimFee(descriptor.txId, descriptor.outputIndex, descriptor.refundAddress);
        const payout = BigInt(descriptor.atoms) - fee;
        if (payout <= 0n) throw new HtlcError('rejected', 'the lock cannot cover the refund fee');
        const htlcInput = await utxoInput(descriptor.txId, descriptor.outputIndex);
        const htlcOutputBytes = await b().encodeOutputHtlc(
          await htlcOutputParams(descriptor.atoms, descriptor.secretHash, descriptor.spendAddress, descriptor.refundAddress, descriptor.refundTimelock),
        );
        const inputs = [htlcInput];
        const outputs = [await b().encodeOutputTransfer(payout.toString(), descriptor.refundAddress, cfg.network)];
        const transaction = await b().encodeTransaction(inputs, outputs, 0);
        const tip = await cfg.indexer.tip();
        const signedHex = await cfg.withSession((session) =>
          signWithKey(transaction, descriptor.refundAddress, [htlcOutputBytes], session, tip.blockHeight + 1, undefined, 'htlc-refund'),
        );
        return { txId: await broadcast(transaction, signedHex) };
      });
    },

    async extractSecret(rawSignedTx, htlcOutpoint) {
      if (rawSignedTx.length === 0) throw new HtlcError('rejected', 'the signed claim transaction bytes are empty');
      // The extraction consumes the encodeOutpointSourceId blob for the
      // HTLC output (the vendored docs), not the bare 32-byte id.
      const outpointSourceId = await b().encodeOutpointSourceId(htlcOutpoint.id, 'transaction');
      // strictByteSize=false: the input is a signed transaction whose
      // witness list trails the transaction body, which strict decoding
      // rejects (the vendored getTransactionId/extractHtlcSecret docs).
      return b().extractHtlcSecret(rawSignedTx, false, outpointSourceId, htlcOutpoint.index);
    },
  };

  /** Claim and refund build against a fee estimate of the same shape: one
   *  HTLC input, one payout output, standard tier rate. The estimate uses
   *  the real HTLC output index, not a guessed slot. */
  async function claimFee(htlcTxId: string, outputIndex: number, destination: string): Promise<bigint> {
    const rate = await cfg.indexer.feerate(STANDARD_TIER_IN_TOP_MB);
    const input = await utxoInput(htlcTxId, outputIndex);
    const output = await b().encodeOutputTransfer('0', destination, cfg.network);
    const size = await b().estimateTransactionSize([input], [destination], [output], cfg.network);
    const kbCeil = BigInt(Math.max(1, Math.ceil(size / 1000)));
    const rateBig = BigInt(/^\d+$/.test(rate) ? rate : '0');
    return kbCeil * (rateBig > 1n ? rateBig : 1n);
  }

  /** Single-input HTLC signing over the dedicated witness encoders (the
   *  normal encodeWitness path cannot carry the preimage). */
  async function signWithKey(
    transaction: Uint8Array,
    address: string,
    spentOutputs: Uint8Array[],
    session: KeySession,
    inclusionHeight: number,
    secret: Uint8Array | undefined,
    kind: 'htlc-spend' | 'htlc-refund',
  ): Promise<string> {
    return session.withSeed(async (seed) => {
      const { xpub } = mlXpubFromSeed(seed, cfg.network as 'mainnet' | 'testnet');
      const origin = await resolveOrigin(xpub, address);
      const privateKey = mlPrivateKeyFromSeed(seed, cfg.network as 'mainnet' | 'testnet', origin.branch, origin.index);
      const params = {
        sighashType: 'all' as const,
        privateKey,
        address,
        transaction,
        inputUtxos: spentOutputs,
        inputIndex: 0,
        inclusionHeight,
        network: cfg.network,
        ...(secret !== undefined ? { secret } : {}),
      };
      const witness =
        kind === 'htlc-spend'
          ? await b().encodeWitnessHtlcSpend(params)
          : await b().encodeWitnessHtlcRefundSingleSig(params);
      const signed = await b().encodeSignedTransaction(transaction, [witness]);
      return bytesToHex(signed);
    });
  }
}

/** SHA-256 of the swap preimage (the only form that crosses the wire or
 *  storage; the preimage itself never persists and never logs). */
export function secretHashOf(secret: Uint8Array): Uint8Array {
  return sha256(secret);
}
