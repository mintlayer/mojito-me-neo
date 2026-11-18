// Real send service gate (spec M3 testing section): the service-level send
// pipeline over an in-memory address manager and a scripted BTC chain
// double. Covers the funding-reachability fix (UTXOs across every managed
// address, change back to a fresh branch 1 address) and the per-service
// send serialization (typed busy refusal). Offline; the seed only exists
// inside the synthetic KeySession closure.
//   tsx src/data/real/realSend.test.ts
import { strict as assert } from 'node:assert/strict';

import { Transaction } from '@scure/btc-signer';

import { createRealSend } from './realSend';
import { createAddressManager, type AddressManager } from '../addresses/AddressManager';
import { deriveBtcAccount, btcAddressAt } from '../../keys/BtcKeyring';
import { mnemonicToSeedSync } from '../../keys/bip39';
import type { KeySession } from '../../keys/session';
import { TxTracker } from '../../send/TxTracker';
import { SendError } from '../../send/errors';
import type { BtcChainService, BtcUtxo } from '../btc/BtcChainService';
import { BroadcastError } from '../providers/BroadcastProvider';
import type { BroadcastProvider } from '../providers/types';
import type { NetworkFlag } from '../../config/endpoints';
import type { RealAccountContext } from './account';

// Published BIP84 vector 1 (the same vectors the builder gate pins) plus a
// second account whose addresses are valid recipients outside the wallet.
const VECTOR_12 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' ');
const VECTOR_23 = [...Array(23).fill('abandon'), 'art'];
const TXID_A = '11'.repeat(32);
const TXID_B = '22'.repeat(32);

function utxo(txid: string, vout: number, valueSat: string, confirmed = true): BtcUtxo {
  return { txid, vout, valueSat, confirmed, blockTime: null };
}

type Harness = {
  send: ReturnType<typeof createRealSend>;
  manager: AddressManager;
  btcIndexes: () => { receiving: number; change: number };
  broadcastHexes: string[];
  gateBroadcast: () => void;
  releaseBroadcast: () => void;
  scriptBroadcastAnswer: (txId: string) => void;
  breakBookkeeping: () => void;
  failBroadcastOnce: () => void;
};

/** One real send service over an in-memory store, a scripted BTC client and
 *  an echo broadcaster (answers the locally computed id, like a well-behaved
 *  Esplora backend). gateBroadcast holds the first broadcast open so tests
 *  can start a second send while the first is still in flight. */
async function harness(opts?: {
  funded?: Record<string, BtcUtxo[]>;
  btcIndexes?: { receiving: number; change: number };
  feeEstimates?: Record<string, number>;
}): Promise<Harness> {
  const network: NetworkFlag = 'mainnet';
  const account = await deriveBtcAccount(VECTOR_12, network);
  const btcXpub = account.xpub;
  const store: { mainnet: { ml: { receiving: number; change: number }; btc: { receiving: number; change: number } } } = {
    mainnet: { ml: { receiving: 0, change: 0 }, btc: { ...(opts?.btcIndexes ?? { receiving: 0, change: 0 }) } },
  };
  const manager = createAddressManager({
    network,
    load: async () => store,
    save: async (_net, chain, indexes) => {
      store.mainnet[chain] = { ...indexes };
    },
    derive: {
      ml: async () => 'mtc1qkv9d8t4xu2nx5pqxe2u3a8mw0g7e0a4ftpqlsm',
      btc: async (branch, index) => btcAddressAt({ xpub: btcXpub, network }, branch, index),
    },
  });
  const btc = {
    async utxos(address: string): Promise<BtcUtxo[]> {
      return opts?.funded?.[address] ?? [];
    },
    async feeEstimates(): Promise<Record<string, number>> {
      return opts?.feeEstimates ?? { '6': 3, '3': 5, '1': 8 };
    },
  };
  const context: RealAccountContext = {
    cfg: {
      network,
      indexerBase: null,
      btcBase: 'https://btc.example.test/api',
      deriveXpubs: async () => ({ mlXpub: new Uint8Array(32), btcXpub }),
    },
    ensureAccount: async () => ({ manager, balance: null, nfts: null, activity: null, btc: btc as BtcChainService }),
    requireIndexerBase: () => {},
    indexer: null,
    btc: null,
  };
  let holdBroadcast = false;
  let releaseFn: (() => void) | null = null;
  let scriptedAnswer: string | null = null;
  let bookkeepingBroken = false;
  let failNextBroadcast = false;
  const broadcastHexes: string[] = [];
  const provider: BroadcastProvider = {
    async broadcastMl() {
      return { txId: 'b'.repeat(64) };
    },
    async broadcastBtc(hex) {
      broadcastHexes.push(hex);
      if (failNextBroadcast) {
        failNextBroadcast = false;
        throw new BroadcastError('btc', 'network', undefined, undefined);
      }
      if (holdBroadcast) await new Promise<void>((resolve) => { releaseFn = resolve; });
      const parsed = Transaction.fromRaw(new Uint8Array(Buffer.from(hex, 'hex')));
      return { txId: scriptedAnswer ?? parsed.id };
    },
    async getMlStatus() {
      return { state: 'pending' };
    },
    async getBtcStatus() {
      return { state: 'pending' };
    },
  };
  const realTracker = new TxTracker(provider, { timers: { set: () => 0, clear: () => {} } });
  const tracker = {
    track: (tx: { id: string; chain: 'ml' | 'btc' }) => {
      if (bookkeepingBroken) throw new Error('storage unavailable');
      return realTracker.track(tx);
    },
    get: realTracker.get.bind(realTracker),
    subscribe: realTracker.subscribe.bind(realTracker),
  } as unknown as TxTracker;
  const seed = mnemonicToSeedSync(VECTOR_12);
  const send = createRealSend({
    context,
    broadcastBase: null,
    loadBindings: () => {
      throw new Error('bindings must not load in the BTC gate');
    },
    broadcast: provider,
    tracker,
    withSession: async (fn) =>
      fn({ withSeed: (run: (s: Uint8Array) => Promise<string>) => run(seed) } as unknown as KeySession),
  });
  return {
    send,
    manager,
    btcIndexes: () => store.mainnet.btc,
    broadcastHexes,
    gateBroadcast: () => {
      holdBroadcast = true;
    },
    releaseBroadcast: () => {
      const fn = releaseFn;
      releaseFn = null;
      holdBroadcast = false;
      if (fn !== null) fn();
    },
    scriptBroadcastAnswer: (txId) => {
      scriptedAnswer = txId;
    },
    breakBookkeeping: () => {
      bookkeepingBroken = true;
    },
    failBroadcastOnce: () => {
      failNextBroadcast = true;
    },
  };
}

async function main() {
  const xpub12 = (await deriveBtcAccount(VECTOR_12, 'mainnet')).xpub;
  const foreignXpub = (await deriveBtcAccount(VECTOR_23, 'mainnet')).xpub;
  const recipient = await btcAddressAt({ xpub: foreignXpub, network: 'mainnet' }, 0, 0);
  const changeAt = async (index: number): Promise<string> => btcAddressAt({ xpub: xpub12, network: 'mainnet' }, 1, index);

  // 1. Two funded addresses (receiving 0 and change 0): the send spends
  //    both and the change lands on a fresh branch 1 address, then the
  //    receiving and change counters advance. This is the second-send flow:
  //    a single-address service would strand the change UTXO instead.
  {
    const recv0 = await btcAddressAt({ xpub: xpub12, network: 'mainnet' }, 0, 0);
    const change0 = await changeAt(0);
    const h = await harness({
      btcIndexes: { receiving: 0, change: 1 },
      funded: { [recv0]: [utxo(TXID_A, 0, '60000')], [change0]: [utxo(TXID_B, 0, '60000')] },
    });
    const result = await h.send.sendBtc({ to: recipient, amountDecimal: '0.0009', tier: 'standard' });
    const parsed = Transaction.fromRaw(new Uint8Array(Buffer.from(h.broadcastHexes[0], 'hex')));
    assert.equal(result.kind, 'btc');
    assert.equal(result.demo, false);
    assert.equal(result.txId, parsed.id, 'the returned id is the signed transaction id');
    assert.equal(parsed.inputsLength, 2, 'both funded origins are selected');
    // BIP69 orders outputs by amount ascending, so match legs by address.
    const expectedChange = await changeAt(1);
    const legs = [0, 1].map((i) => ({ address: parsed.getOutputAddress(i), amount: parsed.getOutput(i)?.amount ?? 0n }));
    assert.deepEqual(legs.map((l) => l.address).sort(), [recipient, expectedChange].sort());
    assert.equal(legs.find((l) => l.address === recipient)?.amount, 90000n);
    // Standard tier rides fee-estimates target 3 (5 sat/vB): fee = rate * vsize.
    assert.equal(legs.find((l) => l.address === expectedChange)?.amount, 30000n - BigInt(parsed.vsize) * 5n);
    assert.equal(h.btcIndexes().receiving, 1, 'fresh-address rotation advanced the receiving index');
    assert.equal(h.btcIndexes().change, 2, 'one allocation advanced the change index');
  }

  // 2. One send at a time: while the first send sits between sign and
  //    broadcast, a second send is refused with the typed busy error
  //    instead of selecting the same UTXOs and racing the rotation
  //    counters. The first send still completes cleanly when released.
  {
    const recv0 = await btcAddressAt({ xpub: xpub12, network: 'mainnet' }, 0, 0);
    const h = await harness({ funded: { [recv0]: [utxo(TXID_A, 0, '100000')] } });
    h.gateBroadcast();
    const first = h.send.sendBtc({ to: recipient, amountDecimal: '0.0001', tier: 'standard' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await assert.rejects(
      () => h.send.sendBtc({ to: recipient, amountDecimal: '0.0001', tier: 'standard' }),
      (e: unknown) => e instanceof SendError && e.kind === 'busy',
      'a concurrent send is refused typed, not queued',
    );
    h.releaseBroadcast();
    const done = await first;
    assert.equal(h.btcIndexes().receiving, 1, 'the refused send left the counters untouched');
    assert.equal(h.btcIndexes().change, 1, 'exactly one change allocation happened');
    assert.match(done.txId, /^[0-9a-f]{64}$/);
  }

  // 3. The broadcast answer must match the locally computed id: a lying
  //    backend answer is a typed rejection and never reaches the tracker.
  {
    const recv0 = await btcAddressAt({ xpub: xpub12, network: 'mainnet' }, 0, 0);
    const h = await harness({ funded: { [recv0]: [utxo(TXID_A, 0, '100000')] } });
    h.scriptBroadcastAnswer('c'.repeat(64));
    await assert.rejects(
      () => h.send.sendBtc({ to: recipient, amountDecimal: '0.0001', tier: 'standard' }),
      (e: unknown) => e instanceof SendError && e.kind === 'txid-mismatch',
      'a mismatched broadcast answer is a typed rejection',
    );
    assert.equal(h.btcIndexes().receiving, 0, 'no rotation happened for the rejected send');
    assert.equal(h.btcIndexes().change, 0, 'no change index burned for the rejected send');
  }

  // 4. Fee pinning: the reviewed rate signs; a fresh estimate above it
  //    refuses typed (ask the user to re-review), at or below it proceeds
  //    with the pinned rate so the signed fee is the reviewed fee.
  {
    const recv0 = await btcAddressAt({ xpub: xpub12, network: 'mainnet' }, 0, 0);
    const h = await harness({ funded: { [recv0]: [utxo(TXID_A, 0, '100000')] }, feeEstimates: { '6': 3, '3': 5, '1': 8 } });
    await assert.rejects(
      () => h.send.sendBtc({ to: recipient, amountDecimal: '0.0001', tier: 'standard', satPerVbyte: '4' }),
      (e: unknown) => e instanceof SendError && e.kind === 'stale-fee',
      'fresh 5 sat/vB is above the reviewed 4: fail safe, re-review',
    );
    assert.equal(h.btcIndexes().change, 0, 'the refused send allocated nothing');
    const done = await h.send.sendBtc({ to: recipient, amountDecimal: '0.0001', tier: 'standard', satPerVbyte: '5' });
    assert.match(done.txId, /^[0-9a-f]{64}$/);
    const parsed = Transaction.fromRaw(new Uint8Array(Buffer.from(h.broadcastHexes.at(-1) ?? '', 'hex')));
    const leg = [0, 1].map((i) => parsed.getOutput(i)?.amount ?? 0n);
    const outputs = leg[0] + leg[1];
    const inputs = 100000n;
    assert.equal(inputs - outputs, BigInt(parsed.vsize) * 5n, 'the signed fee uses the pinned reviewed rate');
  }

  // 5. A quote is read-only on the change bookkeeping: repeated quotes never
  //    advance or persist the branch 1 index, and one send allocates once.
  {
    const recv0 = await btcAddressAt({ xpub: xpub12, network: 'mainnet' }, 0, 0);
    const h = await harness({ btcIndexes: { receiving: 0, change: 0 }, funded: { [recv0]: [utxo(TXID_A, 0, '100000')] } });
    await h.send.quoteBtc({ to: recipient, amountDecimal: '0.0001' });
    await h.send.quoteBtc({ to: recipient, amountDecimal: '0.0002' });
    await h.send.quoteBtc({ to: recipient, amountDecimal: '0.0003' });
    assert.deepEqual(h.btcIndexes(), { receiving: 0, change: 0 }, 'quotes never touch the indexes');
    await h.send.sendBtc({ to: recipient, amountDecimal: '0.0001', tier: 'standard' });
    assert.deepEqual(h.btcIndexes(), { receiving: 1, change: 1 }, 'exactly one send-time allocation');
  }

  // 6. Post-broadcast storage failure: the transaction is on the network,
  //    so a tracker or rotation failure returns success with a warning and
  //    the rotation state stays untouched.
  {
    const recv0 = await btcAddressAt({ xpub: xpub12, network: 'mainnet' }, 0, 0);
    const h = await harness({ funded: { [recv0]: [utxo(TXID_A, 0, '100000')] } });
    h.breakBookkeeping();
    const result = await h.send.sendBtc({ to: recipient, amountDecimal: '0.0001', tier: 'standard' });
    assert.equal(result.warning, true, 'broadcast tx reads as success with a warning');
    assert.match(result.txId, /^[0-9a-f]{64}$/);
    assert.deepEqual(h.btcIndexes(), { receiving: 0, change: 1 }, 'rotation failed before persisting');
  }

  // 7. Change index above the fixed origin walk ceiling is still spendable:
  //    the service hands the builder the persisted counters, so a wallet
  //    with 600 allocated change addresses funds from change 599.
  {
    const changeHigh = await changeAt(599);
    const h = await harness({
      btcIndexes: { receiving: 0, change: 600 },
      funded: { [changeHigh]: [utxo(TXID_A, 0, '100000')] },
    });
    const result = await h.send.sendBtc({ to: recipient, amountDecimal: '0.0001', tier: 'standard' });
    assert.match(result.txId, /^[0-9a-f]{64}$/);
    const parsed = Transaction.fromRaw(new Uint8Array(Buffer.from(h.broadcastHexes[0], 'hex')));
    assert.equal(parsed.inputsLength, 1, 'the high change UTXO is selected and signed');
    assert.equal(h.btcIndexes().change, 601, 'exactly one allocation past the long history');
  }

  // 8. A failed send does not consume the change index: selection failures
  //    and broadcast refusals both release the allocation, and the next
  //    send allocates exactly once.
  {
    const recv0 = await btcAddressAt({ xpub: xpub12, network: 'mainnet' }, 0, 0);
    const h = await harness({ funded: { [recv0]: [utxo(TXID_A, 0, '10000')] } });
    await assert.rejects(
      () => h.send.sendBtc({ to: recipient, amountDecimal: '0.0009', tier: 'standard' }),
      (e: unknown) => e instanceof SendError && e.kind === 'insufficient-funds',
      'underfunded send fails typed',
    );
    assert.equal(h.btcIndexes().change, 0, 'the failed selection released the change allocation');
    h.failBroadcastOnce();
    await assert.rejects(
      () => h.send.sendBtc({ to: recipient, amountDecimal: '0.00005', tier: 'standard' }),
      (e: unknown) => e instanceof SendError && e.kind === 'timeout',
      'broadcast network failure maps typed',
    );
    assert.equal(h.btcIndexes().change, 0, 'the failed broadcast released the change allocation');
    const done = await h.send.sendBtc({ to: recipient, amountDecimal: '0.00005', tier: 'standard' });
    assert.match(done.txId, /^[0-9a-f]{64}$/);
    assert.equal(h.btcIndexes().change, 1, 'the successful send allocated exactly one change index');
  }

  console.log('realSend.test: ok');
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
