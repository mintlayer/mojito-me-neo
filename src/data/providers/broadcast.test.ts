// Broadcast provider gate (missing-architecture gap 3, R3): mock mode
// answers a deterministic fake id; the real ML route posts the exact hex
// body and maps 403 to the typed disabled failure; BTC rides the Esplora
// POST tx shape. Status reads map pending, confirmed and not-found. All
// offline against scripted fetches.
//   tsx src/data/providers/broadcast.test.ts
import { strict as assert } from 'node:assert/strict';

import { createBroadcastProvider, BroadcastError } from './BroadcastProvider';
import { createFixtureBroadcastProvider } from '../mock/fixtures';
import { IndexerError } from '../ml/IndexerClient';
import type { FetchLike } from '../transport';

const SIGNED_HEX = 'aa'.repeat(120);

function scriptedFetch(responses: { status: number; body?: unknown; text?: string }[]): { fetch: FetchLike; calls: { url: string; method?: string; body?: string; headers?: Record<string, string> }[] } {
  const calls: { url: string; method?: string; body?: string; headers?: Record<string, string> }[] = [];
  let index = 0;
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body, headers: init.headers });
    if (index >= responses.length) throw new Error('no scripted response left');
    const response = responses[index++];
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      headers: { get: () => null },
      text: async () => (response.text !== undefined ? response.text : JSON.stringify(response.body ?? null)),
    };
  };
  return { fetch, calls };
}

const TXID = 'a1075db55d416d7caaf6e3b8eb4c1c9a1f6a520d7f2d3f8a4e0f1c2b3a49586d';

async function main() {
  // 1. Mock mode (R3): the deterministic fake id after a delay, both chains.
  {
    const mock = createBroadcastProvider({
      mode: 'mock',
      broadcastBase: null,
      indexerBase: null,
      btcBase: null,
    });
    const ml = await mock.broadcastMl(SIGNED_HEX);
    const btc = await mock.broadcastBtc(SIGNED_HEX);
    assert.match(ml.txId, /^[0-9a-f]{64}$/);
    assert.match(btc.txId, /^[0-9a-f]{64}$/);
    const mlAgain = await mock.broadcastMl(SIGNED_HEX);
    assert.equal(mlAgain.txId, ml.txId, 'deterministic per payload');
    const fixture = createFixtureBroadcastProvider();
    assert.equal((await fixture.broadcastMl(SIGNED_HEX)).txId, ml.txId, 'mock mode rides the fixture provider');
    assert.deepEqual(await mock.getMlStatus(ml.txId), { state: 'pending' });
    await assert.rejects(() => mock.broadcastMl('nothex'), /invalid signed transaction hex/);
  }

  // 2. Real mode, no config: honest disabled failures, no network calls.
  {
    const provider = createBroadcastProvider({ mode: 'real', broadcastBase: null, indexerBase: null, btcBase: null });
    await assert.rejects(
      () => provider.broadcastMl(SIGNED_HEX),
      (e: unknown) => e instanceof BroadcastError && e.chain === 'ml' && e.failure === 'disabled',
    );
    await assert.rejects(
      () => provider.broadcastBtc(SIGNED_HEX),
      (e: unknown) => e instanceof BroadcastError && e.chain === 'btc' && e.failure === 'disabled',
    );
    assert.deepEqual(await provider.getMlStatus(TXID), { state: 'pending' }, 'status degrades to pending without a reader');
    assert.deepEqual(await provider.getBtcStatus(TXID), { state: 'pending' });
  }

  // 3. Real ML submission: exact POST shape, JSON-string tx id answer.
  {
    const { fetch, calls } = scriptedFetch([{ status: 200, text: JSON.stringify(TXID) }]);
    const provider = createBroadcastProvider({
      mode: 'real',
      broadcastBase: 'http://localhost:13000/api/v2',
      indexerBase: null,
      btcBase: null,
      fetch,
      delay: () => Promise.resolve(),
    });
    const { txId } = await provider.broadcastMl(SIGNED_HEX);
    assert.equal(txId, TXID);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith('/transaction'), 'posts to /transaction');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].body, SIGNED_HEX, 'hex body without 0x, no newlines');
    assert.equal(calls[0].headers?.['Content-Type'], 'application/octet-stream');
  }

  // 4. Real ML 403 maps to disabled (F7 production reality); other http
  //    failures map to failed; transport failures map to network.
  {
    const { fetch } = scriptedFetch([
      { status: 403, body: { error: 'route disabled' } },
      { status: 400, body: { error: 'bad encoding' } },
    ]);
    const provider = createBroadcastProvider({
      mode: 'real',
      broadcastBase: 'http://localhost:13000/api/v2',
      indexerBase: null,
      btcBase: null,
      fetch,
      delay: () => Promise.resolve(),
    });
    await assert.rejects(
      () => provider.broadcastMl(SIGNED_HEX),
      (e: unknown) => e instanceof BroadcastError && e.failure === 'disabled' && e.status === 403,
    );
    await assert.rejects(
      () => provider.broadcastMl(SIGNED_HEX),
      (e: unknown) => e instanceof BroadcastError && e.failure === 'failed',
    );
    const dead = createBroadcastProvider({
      mode: 'real',
      broadcastBase: 'http://localhost:13000/api/v2',
      indexerBase: null,
      btcBase: null,
      fetch: async () => {
        throw new Error('connection refused');
      },
      delay: () => Promise.resolve(),
    });
    await assert.rejects(
      () => dead.broadcastMl(SIGNED_HEX),
      (e: unknown) => e instanceof BroadcastError && e.failure === 'network',
    );
  }

  // 5. Real BTC submission rides the Esplora POST tx shape; a plain-text
  //    txid answer is accepted.
  {
    const { fetch, calls } = scriptedFetch([{ status: 200, text: TXID }]);
    const provider = createBroadcastProvider({
      mode: 'real',
      broadcastBase: null,
      indexerBase: null,
      btcBase: 'http://localhost:3100/api/bitcoin',
      fetch,
      delay: () => Promise.resolve(),
    });
    const { txId } = await provider.broadcastBtc(SIGNED_HEX);
    assert.equal(txId, TXID);
    assert.ok(calls[0].url.endsWith('/tx'), 'posts to /tx');
    assert.equal(calls[0].body, SIGNED_HEX);
  }

  // 6. Status reads: pending, confirmed with block id, not-found on 404.
  {
    const { fetch } = scriptedFetch([
      { status: 200, body: { id: TXID, block_id: null, confirmations: null, timestamp: null, inputs: [], outputs: [], fee: null } },
      { status: 200, body: { id: TXID, block_id: 'bb'.repeat(32), confirmations: 3, timestamp: 1700000000, inputs: [], outputs: [], fee: { atoms: '1000' } } },
      { status: 404, body: { error: 'Transaction not found' } },
    ]);
    const provider = createBroadcastProvider({
      mode: 'real',
      broadcastBase: 'http://localhost:13000/api/v2',
      indexerBase: 'http://localhost:13000/api/v2',
      btcBase: null,
      fetch,
      delay: () => Promise.resolve(),
    });
    assert.deepEqual(await provider.getMlStatus(TXID), { state: 'pending' });
    const confirmed = await provider.getMlStatus(TXID);
    assert.equal(confirmed.state, 'confirmed');
    assert.equal(confirmed.blockId, 'bb'.repeat(32));
    assert.equal(confirmed.confirmations, 3);
    const missing = await provider.getMlStatus(TXID);
    assert.equal(missing.state, 'not-found');
  }

  // 7. BTC status rides txStatus; the confirmation count is computed
  //    against the chain tip, and a tip failure keeps the count-less
  //    confirmed answer (an unknown count must not render as zero).
  {
    const { fetch } = scriptedFetch([
      { status: 200, body: { confirmed: true, block_height: 100, block_time: 1700000000 } },
      { status: 200, body: 103 },
      { status: 200, body: { confirmed: true, block_height: 100, block_time: 1700000000 } },
      { status: 500, body: {} },
      { status: 500, body: {} },
      { status: 500, body: {} },
      { status: 200, body: { confirmed: false, block_time: null } },
    ]);
    const provider = createBroadcastProvider({
      mode: 'real',
      broadcastBase: null,
      indexerBase: null,
      btcBase: 'http://localhost:3100/api/bitcoin',
      fetch,
      delay: () => Promise.resolve(),
    });
    assert.deepEqual(await provider.getBtcStatus(TXID), { state: 'confirmed', confirmations: 4 });
    assert.deepEqual(await provider.getBtcStatus(TXID), { state: 'confirmed' }, 'tip failure: count-less confirmed');
    assert.deepEqual(await provider.getBtcStatus(TXID), { state: 'pending' });
  }

  // 8. Plaintext base URL guard: a non-https remote base fails at creation.
  assert.throws(
    () => createBroadcastProvider({ mode: 'real', broadcastBase: 'http://evil.example/api/v2', indexerBase: null, btcBase: null }),
    /https/,
  );

  // 9. IndexerError re-export identity stays intact for shared copies.
  assert.ok(new IndexerError('parse', 'x') instanceof Error);

  console.log('broadcast.test: ok');
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
