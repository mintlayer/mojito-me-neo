// HTLC flow gate (spec M4 testing section): the lock output encodes the
// F10 parameters, the claim witness rides the revealed secret, the refund
// witness builds the single-sig path and refuses unexpired locks, and the
// secret extraction round-trips on a fixture signed transaction. Offline
// over the recording bindings double (device-pending honest states).
//   tsx src/trade/htlc.test.ts
import { strict as assert } from 'node:assert/strict';

import { bytesToHex } from '@noble/hashes/utils.js';
import { hex as hexOf } from '@scure/base';

import type { MintlayerBindings, WitnessParams } from '../../modules/mojito-core';
import type { MlUtxo } from '../data/ml/types';
import type { BroadcastProvider } from '../data/providers/types';
import type { KeySession } from '../keys/session';
import { deriveMlAccount, mlAddressAt, mlPrivateKeyFromSeed } from '../keys/mlAccounts';
import { mnemonicToSeed } from '../keys/bip39';
import { TIMELOCK_RULE, createHtlcFlows, secretHashOf, HtlcError } from './htlc';

const VECTOR_WORDS = [...Array(23).fill('abandon'), 'art'];
const VECTOR_ADDRESS = 'mtc1q82twmwwxa3l2pe26gf0zgghu69jtez3qq2ajqyl';
const ML = 10n ** 11n;
const atoms = (ml: bigint): string => (ml * ML).toString();
const SECRET = new Uint8Array(32).fill(0x42);
const SECRET_HASH = secretHashOf(SECRET);
const LOCK_TX_ID = 'aa'.repeat(32);
const SPEND_PUBKEY = new Uint8Array(33).fill(0x02);

type HtlcJson = { atoms: string; secret_hash: string; spend_address: string; spend_pubkey: string; refund_address: string; refund_timelock: number };

/** The unsigned lock transaction bytes as the flows return them from
 *  initiate; the claim and refund decodes consume bytes, never the tx id. */
const LOCK_TX_BYTES = new TextEncoder().encode('lock-tx-fixture:claim-refund-decode-input');

function fakeBindings(htlcJson: HtlcJson, outputIndex = 0): MintlayerBindings & {
  witnesses: WitnessParams[];
  htlcOutputs: { atoms: string; spendAddress: string; refundAddress: string; timelock: string }[];
  spendWitnesses: WitnessParams[];
  refundWitnesses: WitnessParams[];
  extractCalls: { txId: string; outpoint: string; index: number }[];
  utxoCalls: { sourceId: string; index: number }[];
} {
  const witnesses: WitnessParams[] = [];
  const spendWitnesses: WitnessParams[] = [];
  const refundWitnesses: WitnessParams[] = [];
  const htlcOutputs: { atoms: string; spendAddress: string; refundAddress: string; timelock: string }[] = [];
  const extractCalls: { txId: string; outpoint: string; index: number }[] = [];
  const utxoCalls: { sourceId: string; index: number }[] = [];
  const u32 = (value: number): Uint8Array => {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, value, false);
    return out;
  };
  const cat = (...parts: Uint8Array[]): Uint8Array => {
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  };
  const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
  const u8 = (tag: number): Uint8Array => new Uint8Array([tag]);
  return {
    witnesses,
    spendWitnesses,
    refundWitnesses,
    htlcOutputs,
    extractCalls,
    utxoCalls,
    async encodeOutpointSourceId(id32: Uint8Array) {
      return cat(u8(0x01), id32);
    },
    async encodeLockForSeconds(totalSeconds: number) {
      return utf8(`L:${totalSeconds}`);
    },
    async encodeInputForUtxo(outpointSource: Uint8Array, index: number) {
      utxoCalls.push({ sourceId: bytesToHex(outpointSource.subarray(1)), index });
      return cat(u8(0x02), outpointSource, u32(index));
    },
    async encodeOutputTransfer(atomsStr: string, address: string) {
      return utf8(`T:${atomsStr}:${address}`);
    },
    async encodeOutputTokenTransfer(tokenId: string, atomsStr: string, address: string) {
      return utf8(`K:${tokenId}:${atomsStr}:${address}`);
    },
    async encodeOutputHtlc(params: { amount: string; secretHash: string; spendAddress: string; refundAddress: string; refundTimelock: Uint8Array }) {
      htlcOutputs.push({
        atoms: params.amount,
        spendAddress: params.spendAddress,
        refundAddress: params.refundAddress,
        timelock: new TextDecoder().decode(params.refundTimelock),
      });
      return utf8(`H:${params.amount}:${params.spendAddress}:${new TextDecoder().decode(params.refundTimelock)}`);
    },
    async encodeTransaction(inputs: Uint8Array[], outputs: Uint8Array[]) {
      return cat(u8(0xee), u8(inputs.length), ...inputs, u8(0xff), u8(outputs.length), ...outputs);
    },
    async estimateTransactionSize(inputs: Uint8Array[], destinations: string[], outputs: Uint8Array[]) {
      return 100 + 40 * inputs.length + 30 * outputs.length + destinations.length;
    },
    async getTransactionId(_transaction: Uint8Array) {
      return LOCK_TX_ID;
    },
    async decodeTransactionToJson(transaction: Uint8Array) {
      // Input shape gate: the vendored decode consumes serialized
      // transaction bytes; a tx-id-sized payload is always a bug.
      assert.notEqual(transaction.length, 32, 'decodeTransactionToJson takes transaction bytes, not a tx id');
      assert.ok(transaction.length > 32, 'decodeTransactionToJson takes transaction bytes, not a tx id');
      const outputs: Record<string, unknown>[] = [];
      for (let i = 0; i < outputIndex; i++) outputs.push({ transfer: {} });
      outputs.push({ htlc: htlcJson });
      return JSON.stringify({ outputs });
    },
    async encodeWitness(params: WitnessParams) {
      witnesses.push(params);
      return utf8(`W:${params.inputIndex}`);
    },
    async encodeWitnessHtlcSpend(params: WitnessParams) {
      spendWitnesses.push(params);
      return utf8(`S:${params.inputIndex}:${bytesToHex(params.secret ?? new Uint8Array())}`);
    },
    async encodeWitnessHtlcRefundSingleSig(params: WitnessParams) {
      refundWitnesses.push(params);
      return utf8(`R:${params.inputIndex}`);
    },
    async encodeSignedTransaction(transaction: Uint8Array, txWitnesses: Uint8Array[]) {
      return cat(transaction, ...txWitnesses);
    },
    async extractHtlcSecret(signedTx: Uint8Array, _strict: boolean, outpointSourceId: Uint8Array, outputIndex: number) {
      extractCalls.push({ txId: bytesToHex(signedTx), outpoint: bytesToHex(outpointSourceId), index: outputIndex });
      return SECRET;
    },
  } as unknown as MintlayerBindings & {
    witnesses: WitnessParams[];
    spendWitnesses: WitnessParams[];
    refundWitnesses: WitnessParams[];
    htlcOutputs: { atoms: string; spendAddress: string; refundAddress: string; timelock: string }[];
    extractCalls: { txId: string; outpoint: string; index: number }[];
    utxoCalls: { sourceId: string; index: number }[];
  };
}

function harness(opts?: { htlcJson?: Partial<HtlcJson>; lockTimestamp?: number | null; failBroadcast?: boolean; lyingBroadcast?: string; outputIndex?: number }) {
  const htlcJson: HtlcJson = {
    atoms: atoms(2n),
    secret_hash: bytesToHex(SECRET_HASH),
    spend_address: VECTOR_ADDRESS,
    spend_pubkey: bytesToHex(SPEND_PUBKEY),
    refund_address: VECTOR_ADDRESS,
    refund_timelock: 172800,
    ...opts?.htlcJson,
  };
  const bindings = fakeBindings(htlcJson, opts?.outputIndex ?? 0);
  const changeCounter = { n: 0 };
  const broadcastHexes: string[] = [];
  const utxo = (sourceId: string, amount: string): MlUtxo => ({
    outpoint: { sourceType: 'Transaction', sourceId, index: 0 },
    output: { type: 'Transfer', destination: VECTOR_ADDRESS, value: { type: 'Coin', amount: { atoms: amount } } },
  });
  const indexer = {
    async transaction(id: string) {
      const index = opts?.outputIndex ?? 0;
      const outputs: { type: string; value: { type: string; amount: { atoms: string } } }[] = [];
      for (let i = 0; i < index; i++) outputs.push({ type: 'Transfer', value: { type: 'Coin', amount: { atoms: '0' } } });
      outputs.push({ type: 'Htlc', value: { type: 'Coin', amount: { atoms: htlcJson.atoms } } });
      return {
        id,
        inputs: [],
        outputs,
        fee: null,
        blockId: 'bb'.repeat(32),
        timestamp: opts?.lockTimestamp ?? Math.floor(Date.now() / 1000) - 10,
        confirmations: 3,
      };
    },
    async feerate(): Promise<string> {
      return '1000';
    },
    async spendableUtxos(): Promise<MlUtxo[]> {
      return [utxo('cc'.repeat(32), atoms(10n))];
    },
    async tip() {
      return { blockHeight: 12345, blockId: 'aa'.repeat(32) };
    },
  };
  const broadcast: BroadcastProvider = {
    async broadcastMl(signedTxHex: string) {
      broadcastHexes.push(signedTxHex);
      if (opts?.failBroadcast) {
        throw Object.assign(new Error('disabled'), { name: 'BroadcastError', failure: 'disabled' });
      }
      return { txId: opts?.lyingBroadcast ?? LOCK_TX_ID };
    },
    async broadcastBtc() {
      return { txId: LOCK_TX_ID };
    },
    async getMlStatus() {
      return { state: 'pending' as const };
    },
    async getBtcStatus() {
      return { state: 'pending' as const };
    },
  };
  const flows = createHtlcFlows({
    network: 'mainnet',
    loadBindings: () => bindings,
    indexer: indexer as never,
    broadcast,
    addresses: async () => [VECTOR_ADDRESS],
    allocateChangeAddress: async () => VECTOR_ADDRESS,
    releaseFailedChange: async () => {
      changeCounter.n = Math.max(0, changeCounter.n - 1);
    },
    withSession: async <T,>(fn: (session: KeySession) => Promise<T>): Promise<T> => {
      const seed = await mnemonicToSeed(VECTOR_WORDS);
      return fn({ withSeed: <R,>(run: (s: Uint8Array) => Promise<R>) => run(seed) } as unknown as KeySession);
    },
  });
  return { flows, bindings, broadcastHexes, changeCounter };
}

async function main() {
  const account = await deriveMlAccount(VECTOR_WORDS, 'mainnet');
  assert.equal(await mlAddressAt(account.xpub, 0, 0, 'mainnet'), VECTOR_ADDRESS, 'parity vector address');
  const seed = await mnemonicToSeed(VECTOR_WORDS);
  const expectedKey = bytesToHex(mlPrivateKeyFromSeed(seed, 'mainnet', 0, 0));

  // TIMELOCK_RULE is the recorded F10 string.
  assert.equal(TIMELOCK_RULE, 'btc timelock must be shorter than the mintlayer timelock (F10)');

  // 1. initiate: the lock output encodes the F10 parameters through the
  //    vendored shape (hex hash, encodeLockForSeconds blob), the signed
  //    lock tx broadcasts and the flow returns the unsigned bytes.
  {
    const h = harness();
    const result = await h.flows.initiate(
      { role: 'initiator', giveChain: 'ml', giveAtoms: atoms(2n), wantAtoms: atoms(560n), secretHash: SECRET_HASH, timelockSeconds: 172800 },
      { address: VECTOR_ADDRESS, pubkey: SPEND_PUBKEY },
      VECTOR_ADDRESS,
    );
    assert.equal(result.txId, LOCK_TX_ID);
    assert.ok(result.lockTx.length > 32, 'initiate returns the unsigned lock tx bytes for the session record');
    assert.deepEqual(result.htlcOutpoint.id, hexOf.decode(LOCK_TX_ID));
    assert.equal(result.htlcOutpoint.index, 0);
    // The final (real-build) HTLC output encoding carries the lock params
    // in the vendored shape: atoms, addresses and the seconds lock blob.
    const lock = h.bindings.htlcOutputs[h.bindings.htlcOutputs.length - 1];
    assert.equal(lock.atoms, atoms(2n));
    assert.equal(lock.spendAddress, VECTOR_ADDRESS);
    assert.equal(lock.refundAddress, VECTOR_ADDRESS);
    assert.equal(lock.timelock, 'L:172800');
    // Payer inputs sign normally (no secret on the lock leg).
    assert.equal(h.bindings.witnesses.length, 1);
    assert.equal(bytesToHex(h.bindings.witnesses[0].privateKey), expectedKey);
    assert.equal(h.bindings.witnesses[0].secret, undefined);
    assert.equal(h.broadcastHexes.length, 1);
  }

  // 2. Guard rails: bad hash length, zero amounts and busy serialization.
  {
    const h = harness();
    await assert.rejects(
      () =>
        h.flows.initiate(
          { role: 'initiator', giveChain: 'ml', giveAtoms: atoms(1n), wantAtoms: '1', secretHash: SECRET_HASH.subarray(0, 16), timelockSeconds: 3600 },
          { address: VECTOR_ADDRESS, pubkey: SPEND_PUBKEY },
          VECTOR_ADDRESS,
        ),
      (e: unknown) => e instanceof HtlcError && e.reason === 'rejected',
    );
    await assert.rejects(
      () => h.flows.initiate(
        { role: 'initiator', giveChain: 'ml', giveAtoms: '0', wantAtoms: '1', secretHash: SECRET_HASH, timelockSeconds: 3600 },
        { address: VECTOR_ADDRESS, pubkey: SPEND_PUBKEY },
        VECTOR_ADDRESS,
      ),
      (e: unknown) => e instanceof HtlcError && e.reason === 'rejected',
    );
    const first = h.flows.claim(LOCK_TX_BYTES, SECRET, { address: VECTOR_ADDRESS, pubkey: SPEND_PUBKEY });
    await assert.rejects(
      () => h.flows.claim(LOCK_TX_BYTES, SECRET, { address: VECTOR_ADDRESS, pubkey: SPEND_PUBKEY }),
      (e: unknown) => e instanceof HtlcError && e.reason === 'busy',
    );
    await first;
  }

  // 3. claim: the spend witness carries the preimage and signs against the
  //    re-encoded HTLC output; the decode consumes the lock tx bytes.
  {
    const h = harness();
    const result = await h.flows.claim(LOCK_TX_BYTES, SECRET, { address: VECTOR_ADDRESS, pubkey: SPEND_PUBKEY });
    assert.equal(result.txId, LOCK_TX_ID);
    assert.equal(h.bindings.spendWitnesses.length, 1);
    const witness = h.bindings.spendWitnesses[0];
    assert.equal(bytesToHex(witness.secret ?? new Uint8Array()), bytesToHex(SECRET));
    assert.equal(bytesToHex(witness.privateKey), expectedKey);
    assert.equal(witness.inputIndex, 0);
    assert.equal(witness.inputUtxos?.length, 1);
    assert.ok(witness.inputUtxos?.[0]);
    const text = new TextDecoder().decode(Buffer.from(h.broadcastHexes[0], 'hex'));
    assert.ok(text.includes(`S:0:${bytesToHex(SECRET)}`), 'the claim witness reveals the preimage');
    assert.ok(text.includes('T:'), 'the payout output lands on the spend address');
    // The HTLC input and the fee estimate both ride the descriptor's
    // output index (0 here).
    assert.deepEqual(h.bindings.utxoCalls.map((c) => c.index), [0, 0]);
  }

  // 3b. The fee and input estimates use the real HTLC output index, not a
  //     guessed slot 0.
  {
    const h = harness({ outputIndex: 2 });
    const result = await h.flows.claim(LOCK_TX_BYTES, SECRET, { address: VECTOR_ADDRESS, pubkey: SPEND_PUBKEY });
    assert.equal(result.txId, LOCK_TX_ID);
    assert.deepEqual(h.bindings.utxoCalls.map((c) => c.index), [2, 2], 'the HTLC input and the fee estimate both use output index 2');
  }

  // 3c. A lying broadcast endpoint is refused: the answered id must match
  //     the locally computed transaction id (M3 contract).
  {
    const h = harness({ lyingBroadcast: 'bb'.repeat(32) });
    await assert.rejects(
      () => h.flows.claim(LOCK_TX_BYTES, SECRET, { address: VECTOR_ADDRESS, pubkey: SPEND_PUBKEY }),
      (e: unknown) => e instanceof HtlcError && e.reason === 'rejected',
    );
    const refundH = harness({ lyingBroadcast: 'bb'.repeat(32), lockTimestamp: Math.floor(Date.now() / 1000) - 172_801 });
    await assert.rejects(
      () => refundH.flows.refund(LOCK_TX_BYTES),
      (e: unknown) => e instanceof HtlcError && e.reason === 'rejected',
    );
  }

  // 4. refund: unexpired locks refuse typed; after expiry the single-sig
  //    refund witness builds.
  {
    const h = harness({ lockTimestamp: Math.floor(Date.now() / 1000) - 10 });
    await assert.rejects(
      () => h.flows.refund(LOCK_TX_BYTES),
      (e: unknown) => e instanceof HtlcError && e.reason === 'not-expired',
    );
    const expired = harness({ lockTimestamp: Math.floor(Date.now() / 1000) - 172_801 });
    const result = await expired.flows.refund(LOCK_TX_BYTES);
    assert.equal(result.txId, LOCK_TX_ID);
    assert.equal(expired.bindings.refundWitnesses.length, 1);
    assert.equal(expired.bindings.refundWitnesses[0].inputIndex, 0);
    assert.equal(bytesToHex(expired.bindings.refundWitnesses[0].privateKey), expectedKey);
  }

  // 5. extractSecret: the bindings extraction consumes the raw signed tx
  //    bytes and the encodeOutpointSourceId blob of the HTLC outpoint and
  //    answers the preimage (roundtrip with the fixture claim).
  {
    const h = harness();
    const fixtureSignedTx = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00]);
    const secret = await h.flows.extractSecret(fixtureSignedTx, { id: hexOf.decode(LOCK_TX_ID), index: 0 });
    assert.equal(bytesToHex(secret), bytesToHex(SECRET));
    assert.deepEqual(h.bindings.extractCalls[0], { txId: 'deadbeef00', outpoint: `01${LOCK_TX_ID}`, index: 0 });
    assert.equal(bytesToHex(secretHashOf(secret)), bytesToHex(SECRET_HASH), 'the extracted preimage hashes to the offered secret hash');
  }

  // 6. A transaction with no HTLC output is a typed refusal, not a claim.
  {
    const bindings = fakeBindings({
      atoms: atoms(2n),
      secret_hash: bytesToHex(SECRET_HASH),
      spend_address: VECTOR_ADDRESS,
      spend_pubkey: bytesToHex(SPEND_PUBKEY),
      refund_address: VECTOR_ADDRESS,
      refund_timelock: 172800,
    });
    const indexer = {
      async transaction() {
        return { id: LOCK_TX_ID, inputs: [], outputs: [{ type: 'Transfer', value: { type: 'Coin', amount: { atoms: atoms(2n) } } }], fee: null, blockId: null, timestamp: null, confirmations: null };
      },
      async feerate() {
        return '1000';
      },
      async spendableUtxos() {
        return [];
      },
      async tip() {
        return { blockHeight: 1, blockId: 'aa'.repeat(32) };
      },
    };
    const flows = createHtlcFlows({
      network: 'mainnet',
      loadBindings: () => bindings,
      indexer: indexer as never,
      broadcast: {
        broadcastMl: async () => ({ txId: LOCK_TX_ID }),
        broadcastBtc: async () => ({ txId: LOCK_TX_ID }),
        getMlStatus: async () => ({ state: 'pending' }),
        getBtcStatus: async () => ({ state: 'pending' }),
      },
      addresses: async () => [VECTOR_ADDRESS],
      allocateChangeAddress: async () => VECTOR_ADDRESS,
      releaseFailedChange: async () => undefined,
      withSession: async (fn) => fn({ withSeed: (run: (s: Uint8Array) => Promise<string>) => run(seed) } as unknown as KeySession),
    });
    await assert.rejects(
      () => flows.claim(LOCK_TX_BYTES, SECRET, { address: VECTOR_ADDRESS, pubkey: SPEND_PUBKEY }),
      (e: unknown) => e instanceof HtlcError && e.reason === 'no-htlc-output',
    );
  }

  console.log('htlc: ok');
}

main();
