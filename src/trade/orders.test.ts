// Order flows gate (spec M4 testing section): create builds the order
// output with change legs and extracts the id through the bindings, fill
// carries the no-signature witness on the order input plus signed payer
// inputs, conclude is maker-gated and reclaims to the conclude destination.
// Offline: the pipeline is verified against the MintlayerBindings interface
// contract with a recording double and the derivation parity vectors.
//   tsx src/trade/orders.test.ts
import { strict as assert } from 'node:assert/strict';

import { bytesToHex } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bech32m } from '@scure/base';

import type { MintlayerBindings, OrderParams, WitnessParams } from '../../modules/mojito-core';
import type { MlOrderInfo, MlUtxo } from '../data/ml/types';
import type { BroadcastProvider } from '../data/providers/types';
import { BroadcastError } from '../data/providers/BroadcastProvider';
import type { KeySession } from '../keys/session';
import { deriveMlAccount, mlAddressAt, mlPrivateKeyFromSeed } from '../keys/mlAccounts';
import { mnemonicToSeed } from '../keys/bip39';
import { createOrderFlows, orderFromIndexer, orderPhase, proportionalGivePayout, COIN_REF, OrderFlowError } from './orders';

const VECTOR_WORDS = [...Array(23).fill('abandon'), 'art'];
const VECTOR_ADDRESS = 'mtc1q82twmwwxa3l2pe26gf0zgghu69jtez3qq2ajqyl';
const TOKEN_ID = 'tMLTK10test000000000000000000000000000000000';
/** A valid bech32 mtc1 address that derives from no test account. */
const FOREIGN_ADDRESS = bech32m.encode('mtc1', bech32m.toWords(new Uint8Array(20).fill(0x99)));
const ML = 10n ** 11n;

/** Valid bech32 order id (the flows decode the data payload for the
 *  bindings byte-blob form). */
const ORDER_ID = bech32m.encode('mordr', bech32m.toWords(new Uint8Array([0xab, 0xcd, 0xef, 0x12])));

const atoms = (ml: bigint): string => (ml * ML).toString();
/** Band matching the fixture order price (10 ML give, 7 USDT ask: the
 *  effective fill price is 0.7 ask per give at equal atom scales), so the
 *  guard tests can vary only the order or the mid. */
const FILL_BAND = { midDecimal: '0.7', maxSlippagePct: 1, askDecimals: 11, giveDecimals: 11 };

function fakeBindings(): MintlayerBindings & {
  witnesses: WitnessParams[];
  orderParams: OrderParams[];
  fillCalls: { orderId: string; destination: string; amount: string; nonce: number; height: number }[];
  concludeCalls: { orderId: string; nonce: number; height: number }[];
  idCalls: { inputs: Uint8Array[] }[];
  noSignatureCount: () => number;
} {
  const witnesses: WitnessParams[] = [];
  const orderParams: OrderParams[] = [];
  const fillCalls: { orderId: string; destination: string; amount: string; nonce: number; height: number }[] = [];
  const concludeCalls: { orderId: string; nonce: number; height: number }[] = [];
  const idCalls: { inputs: Uint8Array[] }[] = [];
  let noSignatureCalls = 0;
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
    orderParams,
    fillCalls,
    concludeCalls,
    idCalls,
    noSignatureCount: () => noSignatureCalls,
    async encodeOutpointSourceId(id32: Uint8Array) {
      return cat(u8(0x01), id32);
    },
    async encodeInputForUtxo(outpointSource: Uint8Array, index: number) {
      return cat(u8(0x02), outpointSource, u32(index));
    },
    async encodeOutputTransfer(atomsStr: string, address: string) {
      return utf8(`T:${atomsStr}:${address}`);
    },
    async encodeOutputTokenTransfer(tokenId: string, atomsStr: string, address: string) {
      return utf8(`K:${tokenId}:${atomsStr}:${address}`);
    },
    async encodeCreateOrderOutput(params: OrderParams) {
      orderParams.push(params);
      return utf8(`O:${params.give.tokenId}:${params.give.atoms}:${params.ask.tokenId}:${params.ask.atoms}:${params.concludeDestination}`);
    },
    // The vendored fill input takes the bech32 order id and destination
    // strings plus the account nonce and block height; recorded for the
    // assertions below.
    async encodeInputForFillOrder(orderId: string, fillAmount: string, destination: string, nonce: number, currentBlockHeight: number) {
      fillCalls.push({ orderId, destination, amount: fillAmount, nonce, height: currentBlockHeight });
      return utf8(`F:${orderId}:${destination}:${fillAmount}:${nonce}:${currentBlockHeight}`);
    },
    async encodeInputForConcludeOrder(orderId: string, nonce: number, currentBlockHeight: number) {
      concludeCalls.push({ orderId, nonce, height: currentBlockHeight });
      return utf8(`C:${orderId}:${nonce}:${currentBlockHeight}`);
    },
    async encodeTransaction(inputs: Uint8Array[], outputs: Uint8Array[]) {
      return cat(u8(0xee), u8(inputs.length), ...inputs, u8(0xff), u8(outputs.length), ...outputs);
    },
    async estimateTransactionSize(inputs: Uint8Array[], destinations: string[], outputs: Uint8Array[]) {
      return 100 + 40 * inputs.length + 30 * outputs.length + destinations.length;
    },
    async getTransactionId(transaction: Uint8Array) {
      return bytesToHex(sha256(transaction));
    },
    async encodeWitness(params: WitnessParams) {
      witnesses.push(params);
      return utf8(`W:${params.inputIndex}`);
    },
    async encodeWitnessNoSignature() {
      noSignatureCalls += 1;
      return u8(0x00);
    },
    async encodeSignedTransaction(transaction: Uint8Array, txWitnesses: Uint8Array[]) {
      return cat(transaction, ...txWitnesses);
    },
    async getOrderId(inputs: Uint8Array[]) {
      idCalls.push({ inputs });
      return `mordr1${bytesToHex(sha256(cat(...inputs))).slice(0, 12)}`;
    },
  } as unknown as MintlayerBindings & {
    witnesses: WitnessParams[];
    orderParams: OrderParams[];
    fillCalls: { orderId: string; destination: string; amount: string; nonce: number; height: number }[];
    concludeCalls: { orderId: string; nonce: number; height: number }[];
    idCalls: { inputs: Uint8Array[] }[];
    noSignatureCount: () => number;
  };
}

function coinUtxo(sourceId: string, index: number, address: string, amount: string): MlUtxo {
  return {
    outpoint: { sourceType: 'Transaction', sourceId, index },
    output: { type: 'Transfer', destination: address, value: { type: 'Coin', amount: { atoms: amount } } },
  };
}

function tokenUtxo(sourceId: string, index: number, address: string, amount: string): MlUtxo {
  return {
    outpoint: { sourceType: 'Transaction', sourceId, index },
    output: { type: 'Transfer', destination: address, value: { type: 'TokenV1', tokenId: TOKEN_ID, amount: { atoms: amount } } },
  };
}

type OrderRow = MlOrderInfo;

function orderRow(overrides: Partial<OrderRow>): OrderRow {
  return {
    orderId: ORDER_ID,
    giveBalance: { atoms: atoms(10n) },
    askBalance: { atoms: atoms(7n) },
    giveCurrency: { type: 'Coin' },
    askCurrency: { type: 'Token', tokenId: TOKEN_ID },
    initiallyGiven: null,
    initiallyAsked: null,
    concludeDestination: VECTOR_ADDRESS,
    ...overrides,
  };
}

function harness(opts?: { orders?: OrderRow[]; detail?: OrderRow; utxos?: MlUtxo[]; broadcastFails?: 'disabled' | null }) {
  const bindings = fakeBindings();
  const changeCounter = { n: 0 };
  const broadcastHexes: string[] = [];
  const utxos = opts?.utxos ?? [coinUtxo('aa'.repeat(32), 0, VECTOR_ADDRESS, atoms(500n))];
  const orders = opts?.orders ?? [];
  const indexer = {
    async order(id: string): Promise<MlOrderInfo> {
      const row = opts?.detail ?? orders.find((row) => row.orderId === id);
      if (!row) throw new Error(`no scripted order ${id}`);
      return row;
    },
    async orders(): Promise<MlOrderInfo[]> {
      return orders;
    },
    async ordersByPair(): Promise<MlOrderInfo[]> {
      return orders;
    },
    async feerate(): Promise<string> {
      return '1000';
    },
    async spendableUtxos(address: string): Promise<MlUtxo[]> {
      return utxos.filter((utxo) => utxo.output.destination === address);
    },
    async tip() {
      return { blockHeight: 12345, blockId: 'aa'.repeat(32) };
    },
  };
  /** Echo broadcaster: answers the locally computed id like a well-behaved
   *  backend. The fake signed layout is transaction bytes followed by the
   *  utf8 witness blobs, so the first 'W:' run marks the boundary. */
  const localIdOf = (signedHex: string): string => {
    const bytes = Buffer.from(signedHex, 'hex');
    const marker = Buffer.from('W:');
    let end = bytes.length;
    for (let i = 0; i + 1 < bytes.length; i++) {
      if (bytes[i] === marker[0] && bytes[i + 1] === marker[1] && bytes[i + 2] === 0x30) {
        end = i;
        break;
      }
    }
    return bytesToHex(sha256(new Uint8Array(bytes.subarray(0, end))));
  };
  const broadcast: BroadcastProvider = {
    async broadcastMl(signedTxHex: string) {
      broadcastHexes.push(signedTxHex);
      if (opts?.broadcastFails === 'disabled') {
        throw new BroadcastError('ml', 'disabled', undefined, 'no ML submission endpoint is configured');
      }
      return { txId: localIdOf(signedTxHex) };
    },
    async broadcastBtc() {
      return { txId: 'f'.repeat(64) };
    },
    async getMlStatus() {
      return { state: 'pending' as const };
    },
    async getBtcStatus() {
      return { state: 'pending' as const };
    },
  };
  const flows = createOrderFlows({
    network: 'mainnet',
    loadBindings: () => bindings,
    indexer: indexer as never,
    broadcast,
    addresses: async () => {
      const account = await deriveMlAccount(VECTOR_WORDS, 'mainnet');
      const out = [await mlAddressAt(account.xpub, 0, 0, 'mainnet')];
      for (let i = 0; i < changeCounter.n; i++) out.push(await mlAddressAt(account.xpub, 1, i, 'mainnet'));
      return out;
    },
    allocateChangeAddress: async () => {
      const account = await deriveMlAccount(VECTOR_WORDS, 'mainnet');
      return mlAddressAt(account.xpub, 1, changeCounter.n++, 'mainnet');
    },
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
  const seed = await mnemonicToSeed(VECTOR_WORDS);
  const account = await deriveMlAccount(VECTOR_WORDS, 'mainnet');
  assert.equal(await mlAddressAt(account.xpub, 0, 0, 'mainnet'), VECTOR_ADDRESS, 'parity vector address');
  const expectedKey = bytesToHex(mlPrivateKeyFromSeed(seed, 'mainnet', 0, 0));

  // Order model mapping and lifecycle phase detection (F11).
  const open = orderFromIndexer(orderRow({}));
  assert.equal(open.giveTokenId, COIN_REF);
  assert.equal(open.askTokenId, TOKEN_ID);
  assert.equal(orderPhase(open), 'open');
  assert.equal(orderPhase(orderFromIndexer(orderRow({ frozen: true }))), 'frozen');
  assert.equal(orderPhase(orderFromIndexer(orderRow({ giveBalance: { atoms: '0' }, askBalance: { atoms: '0' } }))), 'concluded');

  // Payout math mirrors mintlayer-core calculate_filled_amount (floor).
  assert.equal(proportionalGivePayout('10', '7', '3'), ((10n * 3n) / 7n).toString());

  // 1. createOrder: order output first, change leg after, id extraction
  //    rides the bindings on transaction output 0.
  {
    const h = harness();
    const result = await h.flows.createOrder({ giveTokenId: COIN_REF, giveAtoms: atoms(5n), askTokenId: TOKEN_ID, askAtoms: atoms(2n) });
    assert.match(result.orderId, /^mordr1/);
    assert.equal(h.bindings.idCalls.length, 1);
    assert.ok(h.bindings.idCalls[0].inputs.length >= 1, 'the order id derives from the create tx inputs');
    assert.ok(h.bindings.orderParams.length >= 2);
    assert.deepEqual(h.bindings.orderParams[h.bindings.orderParams.length - 1].give, { tokenId: 'coin', atoms: atoms(5n) });
    assert.deepEqual(h.bindings.orderParams[h.bindings.orderParams.length - 1].ask, { tokenId: TOKEN_ID, atoms: atoms(2n) });
    assert.ok(h.bindings.orderParams.every((p) => p.concludeDestination.length > 0));
    // One payer input (500 ML covers 5 ML + fee), one signed witness.
    assert.equal(h.bindings.witnesses.length, 1);
    assert.equal(h.bindings.witnesses[0].inputIndex, 0);
    assert.equal(bytesToHex(h.bindings.witnesses[0].privateKey), expectedKey);
    assert.equal(h.broadcastHexes.length, 1);
    // Change counter advanced once and not released (successful order).
    assert.equal(h.changeCounter.n, 1);
  }

  // 2. Broadcast-disabled (R3) maps to the typed flow error and releases
  //    the change allocation.
  {
    const h = harness({ broadcastFails: 'disabled' });
    await assert.rejects(
      () => h.flows.createOrder({ giveTokenId: COIN_REF, giveAtoms: atoms(1n), askTokenId: TOKEN_ID, askAtoms: atoms(1n) }),
      (e: unknown) => e instanceof OrderFlowError && e.reason === 'broadcast-disabled',
    );
    assert.equal(h.changeCounter.n, 0, 'failed attempt steps the change counter back');
  }

  // 3. fillOrder: no-signature witness on the fill input, signed witness on
  //    the payer input, give payout lands on the destination.
  {
    const detail = orderRow({
      orderId: ORDER_ID,
      giveBalance: { atoms: atoms(10n) },
      askBalance: { atoms: atoms(7n) },
      giveCurrency: { type: 'Coin' },
      askCurrency: { type: 'Token', tokenId: TOKEN_ID },
    });
    const askUtxo = tokenUtxo('cc'.repeat(32), 0, VECTOR_ADDRESS, atoms(4n));
    const h = harness({ detail, utxos: [coinUtxo('aa'.repeat(32), 0, VECTOR_ADDRESS, atoms(500n)), askUtxo] });
    const destination = await mlAddressAt(account.xpub, 0, 1, 'mainnet');
    const result = await h.flows.fillOrder({ orderId: ORDER_ID, fillAtoms: atoms(3n), destination, priceBand: { midDecimal: '0.7', maxSlippagePct: 1, askDecimals: 11, giveDecimals: 11 } });
    assert.match(result.txId, /^[0-9a-f]{64}$/);
    assert.equal(h.bindings.fillCalls.length, 1);
    assert.equal(h.bindings.fillCalls[0].amount, atoms(3n));
    assert.equal(h.bindings.fillCalls[0].destination, destination);
    assert.equal(h.bindings.fillCalls[0].orderId, ORDER_ID);
    assert.equal(h.bindings.fillCalls[0].nonce, 0, 'the first account spending of the session carries nonce 0');
    assert.equal(h.bindings.fillCalls[0].height, 12345, 'the input form rides the indexer tip height');
    // Witness mix: the fill input at index 0 is unsigned; both payer
    // inputs (ask token + fee coin) sign with the wallet key.
    assert.equal(h.bindings.noSignatureCount(), 1);
    assert.equal(h.bindings.witnesses.length, 2);
    assert.deepEqual(h.bindings.witnesses.map((w) => w.inputIndex), [1, 2]);
    for (const witness of h.bindings.witnesses) {
      assert.equal(bytesToHex(witness.privateKey), expectedKey);
    }
    // Sighash contract: the spent output rides per input; the order slot
    // stays null (no UTXO behind it).
    const sighashSlots = h.bindings.witnesses[0].inputUtxos;
    assert.equal(sighashSlots?.length, 3);
    assert.equal(sighashSlots?.[0], null);
    assert.ok((sighashSlots?.[1]?.length ?? 0) > 0);
    assert.ok((sighashSlots?.[2]?.length ?? 0) > 0);
    // The signed tx text carries the give payout to the destination and the
    // ask remainder back to change.
    const signedText = new TextDecoder().decode(Buffer.from(h.broadcastHexes[0], 'hex'));
    assert.ok(signedText.includes(`T:${(BigInt(atoms(10n)) * BigInt(atoms(3n)) / BigInt(atoms(7n))).toString()}:${destination}`), 'give payout output to destination');
    assert.ok(signedText.includes(`K:${TOKEN_ID}:${atoms(1n)}:mtc1q88834tz8zzhm6x3mhdfgyms5smsv0s7k5mujmzh`), 'ask remainder returns to change');
  }

  // 4. Fill guards: frozen orders, concluded orders and overbids reject
  //    client-side before any transaction is built.
  {
    const frozen = orderRow({ frozen: true });
    const h = harness({ detail: frozen });
    await assert.rejects(
      () => h.flows.fillOrder({ orderId: ORDER_ID, fillAtoms: atoms(1n), destination: VECTOR_ADDRESS, priceBand: FILL_BAND }),
      (e: unknown) => e instanceof OrderFlowError && e.reason === 'not-open',
    );
    const concluded = orderRow({ giveBalance: { atoms: '0' }, askBalance: { atoms: '0' } });
    const h2 = harness({ detail: concluded });
    await assert.rejects(
      () => h2.flows.fillOrder({ orderId: ORDER_ID, fillAtoms: atoms(1n), destination: VECTOR_ADDRESS, priceBand: FILL_BAND }),
      (e: unknown) => e instanceof OrderFlowError && e.reason === 'not-open',
    );
    const overbid = orderRow({ askBalance: { atoms: atoms(1n) } });
    const h3 = harness({ detail: overbid });
    await assert.rejects(
      () => h3.flows.fillOrder({ orderId: ORDER_ID, fillAtoms: atoms(2n), destination: VECTOR_ADDRESS, priceBand: FILL_BAND }),
      (e: unknown) => e instanceof OrderFlowError && e.reason === 'overbid',
    );
    // A hostile order row with a zero ask leg refuses typed instead of
    // crashing the division.
    const zeroLeg = orderRow({ askBalance: { atoms: atoms(1n) }, initiallyAsked: { atoms: '0' } });
    const h4 = harness({ detail: zeroLeg });
    await assert.rejects(
      () => h4.flows.fillOrder({ orderId: ORDER_ID, fillAtoms: atoms(1n), destination: VECTOR_ADDRESS, priceBand: FILL_BAND }),
      (e: unknown) => e instanceof OrderFlowError && e.reason === 'rejected',
    );
    // The effective price re-check: an order priced far from the book mid
    // refuses typed before any transaction is built.
    const offBook = orderRow({ initiallyGiven: { atoms: atoms(10n) }, initiallyAsked: { atoms: atoms(1n) } });
    const h5 = harness({ detail: offBook });
    await assert.rejects(
      () => h5.flows.fillOrder({ orderId: ORDER_ID, fillAtoms: atoms(1n), destination: VECTOR_ADDRESS, priceBand: { midDecimal: '0.7', maxSlippagePct: 1, askDecimals: 11, giveDecimals: 11 } }),
      (e: unknown) => e instanceof OrderFlowError && e.reason === 'slippage',
    );
    // The same order inside the band passes the guard and builds.
    const inBand = harness({ detail: offBook, utxos: [coinUtxo('aa'.repeat(32), 0, VECTOR_ADDRESS, atoms(500n)), tokenUtxo('dd'.repeat(32), 0, VECTOR_ADDRESS, atoms(4n))] });
    const filled = await inBand.flows.fillOrder({ orderId: ORDER_ID, fillAtoms: atoms(1n), destination: VECTOR_ADDRESS, priceBand: { midDecimal: '0.1', maxSlippagePct: 1, askDecimals: 11, giveDecimals: 11 } });
    assert.match(filled.txId, /^[0-9a-f]{64}$/);
  }

  // 5. concludeOrder: foreign conclude destination refuses as not-mine; the
  //    maker path reclaims both legs to the conclude destination.
  {
    const foreign = orderRow({ concludeDestination: FOREIGN_ADDRESS, giveBalance: { atoms: atoms(4n) }, askBalance: { atoms: atoms(1n) } });
    const h = harness({ detail: foreign });
    await assert.rejects(
      () => h.flows.concludeOrder({ orderId: ORDER_ID }),
      (e: unknown) => e instanceof OrderFlowError && e.reason === 'not-mine',
    );

    const ours = orderRow({ concludeDestination: VECTOR_ADDRESS, giveBalance: { atoms: atoms(4n) }, askBalance: { atoms: atoms(1n) } });
    const h2 = harness({ detail: ours });
    const result = await h2.flows.concludeOrder({ orderId: ORDER_ID });
    assert.match(result.txId, /^[0-9a-f]{64}$/);
    assert.equal(h2.bindings.concludeCalls.length, 1);
    assert.equal(h2.bindings.concludeCalls[0].orderId, ORDER_ID);
    assert.equal(h2.bindings.concludeCalls[0].nonce, 0);
    assert.equal(h2.bindings.concludeCalls[0].height, 12345);
    assert.equal(h2.bindings.noSignatureCount(), 1);
    assert.equal(h2.bindings.witnesses.length, 1);
    assert.equal(bytesToHex(h2.bindings.witnesses[0].privateKey), expectedKey);
    const text = new TextDecoder().decode(Buffer.from(h2.broadcastHexes[0], 'hex'));
    assert.ok(text.includes(`T:${atoms(4n)}:${VECTOR_ADDRESS}`), 'give remainder reclaims');
    assert.ok(text.includes(`K:${TOKEN_ID}:${atoms(1n)}:${VECTOR_ADDRESS}`), 'accumulated asks reclaim');
  }

  // 6. openOrders and myOrders filters.
  {
    const mine = orderRow({ orderId: bech32m.encode('mordr', bech32m.toWords(new Uint8Array([0x01]))), concludeDestination: VECTOR_ADDRESS });
    const other = orderRow({ orderId: bech32m.encode('mordr', bech32m.toWords(new Uint8Array([0x02]))), concludeDestination: FOREIGN_ADDRESS });
    const h = harness({ orders: [mine, other] });
    const open = await h.flows.openOrders('ML', 'USDT');
    assert.equal(open.length, 2);
    const myOrders = await h.flows.myOrders();
    assert.deepEqual(
      myOrders.map((order) => order.orderId),
      [mine.orderId],
    );
  }

  // 7. Serialization: an overlapping order transaction refuses typed.
  {
    const h = harness();
    const first = h.flows.createOrder({ giveTokenId: COIN_REF, giveAtoms: atoms(5n), askTokenId: TOKEN_ID, askAtoms: atoms(2n) });
    await assert.rejects(
      () => h.flows.createOrder({ giveTokenId: COIN_REF, giveAtoms: atoms(5n), askTokenId: TOKEN_ID, askAtoms: atoms(2n) }),
      (e: unknown) => e instanceof OrderFlowError && e.reason === 'busy',
    );
    await first;
  }

  console.log('orders: ok');
}

main();
