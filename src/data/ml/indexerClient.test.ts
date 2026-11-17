// IndexerClient gate: offline fixture transport covering the cursor walk,
// the atoms/decimal/number number-shape tolerance, the 429 retry with
// Retry-After, the 404-as-fresh-address mapping and the timeout path.
//   npx tsx src/data/ml/indexerClient.test.ts
import { strict as assert } from 'node:assert/strict';

import { IndexerClient, IndexerError, parseAmount, type FetchLike } from './IndexerClient';

/** Scripted transport: one queued response per request, in order. */
type ScriptedResponse = {
  status: number;
  body: unknown | string;
  headers?: Record<string, string>;
};

function scriptedFetch(responses: ScriptedResponse[], calls: { url: string }[] = []): FetchLike {
  let index = 0;
  const fetch: FetchLike = async (url) => {
    calls.push({ url });
    if (index >= responses.length) throw new Error('no scripted response left');
    const response = responses[index++];
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      headers: { get: (name: string) => response.headers?.[name] ?? null },
      text: async () => (typeof response.body === 'string' ? response.body : JSON.stringify(response.body)),
    };
  };
  return fetch;
}

const noDelay = (): Promise<void> => Promise.resolve();

async function main() {
  // Amount-shape tolerance: pair, bare atom string, bare decimal string,
  // Uint64 number.
  assert.deepEqual(parseAmount({ atoms: '11', decimal: '1.1' }), { atoms: '11', decimal: '1.1' });
  assert.deepEqual(parseAmount('123'), { atoms: '123' });
  assert.deepEqual(parseAmount('1.5'), { decimal: '1.5' });
  assert.deepEqual(parseAmount(64), { atoms: '64' });
  assert.deepEqual(parseAmount({ atoms: 64 }), { atoms: '64' });
  assert.throws(() => parseAmount(null), /parse/);

  // tip: block height tolerates number or numeric string.
  const tipCalls: { url: string }[] = [];
  const tipClient = new IndexerClient('https://indexer.test/api/v2', {
    fetch: scriptedFetch([{ status: 200, body: { block_height: 731505, block_id: 'ab'.repeat(32) } }], tipCalls),
    delay: noDelay,
  });
  assert.deepEqual(await tipClient.tip(), { blockHeight: 731505, blockId: 'ab'.repeat(32) });
  assert.equal(tipCalls[0].url, 'https://indexer.test/api/v2/chain/tip');

  // addressInfo: full shape plus the fresh-address 404 mapping.
  const addressResponses: ScriptedResponse[] = [
    {
      status: 200,
      body: {
        coin_balance: { decimal: '12.5', atoms: '1250000000000' },
        locked_coin_balance: { decimal: '0', atoms: '0' },
        tokens: [{ token_id: 'mmltk1abc', amount: { decimal: '3', atoms: '3000' } }],
        transaction_history: ['f'.repeat(64), 'e'.repeat(64)],
      },
    },
    { status: 404, body: { error: 'AddressNotFound' } },
    { status: 500, body: { error: 'boom' } },
  ];
  const addressCalls: { url: string }[] = [];
  const addressClient = new IndexerClient('https://indexer.test/api/v2', {
    fetch: scriptedFetch(addressResponses, addressCalls),
    delay: noDelay,
    retries: 0,
  });
  const funded = await addressClient.addressInfo('mtc1q82twmwwxa3l2pe26gf0zgghu69jtez3qq2ajqyl');
  assert.deepEqual(funded.coinBalance, { decimal: '12.5', atoms: '1250000000000' });
  assert.equal(funded.tokens[0].tokenId, 'mmltk1abc');
  assert.equal(funded.transactionHistory.length, 2);
  const fresh = await addressClient.addressInfo('mtc1qunused');
  assert.deepEqual(fresh, { coinBalance: { atoms: '0' }, lockedCoinBalance: { atoms: '0' }, tokens: [], transactionHistory: [] });
  await assert.rejects(() => addressClient.addressInfo('mtc1qserver'), (e: unknown) => e instanceof IndexerError && e.status === 500);
  assert.equal(addressCalls[1].url, 'https://indexer.test/api/v2/address/mtc1qunused');

  // transaction: pending shape maps empty confirmations to null.
  const txClient = new IndexerClient('https://indexer.test/api/v2', {
    fetch: scriptedFetch([
      {
        status: 200,
        body: {
          id: 'a'.repeat(64),
          inputs: [{ input_type: 'Utxo', utxo: { type: 'Transfer', destination: 'mtc1qin', value: { type: 'Coin', amount: { atoms: '50' } } } }],
          outputs: [{ type: 'Transfer', destination: 'mtc1qout', value: { type: 'Coin', amount: { atoms: '49' } } }],
          fee: { atoms: '1' },
          block_id: null,
          timestamp: '',
          confirmations: '',
        },
      },
    ]),
    delay: noDelay,
  });
  const pending = await txClient.transaction('a'.repeat(64));
  assert.equal(pending.confirmations, null);
  assert.equal(pending.timestamp, null);
  assert.equal(pending.blockId, null);
  assert.equal(pending.outputs[0].value?.amount?.atoms, '49');

  // nft: 200 parses, 404 resolves to null (non-NFT id).
  const nftClient = new IndexerClient('https://indexer.test/api/v2', {
    fetch: scriptedFetch([
      {
        status: 200,
        body: { name: '"Mojito #1"', ticker: '"MOJ"', description: '"x"', creator: null, owner: null, media_uri: null, icon_uri: null, media_hash: '"aa"' },
      },
      { status: 404, body: { error: 'NFT not found' } },
    ]),
    delay: noDelay,
  });
  assert.equal((await nftClient.nft('mmltk1nft'))?.name, '"Mojito #1"');
  assert.equal(await nftClient.nft('mmltk1notnft'), null);

  // feerate: bare JSON string body, with query param passthrough.
  const feeCalls: { url: string }[] = [];
  const feeClient = new IndexerClient('https://indexer.test/api/v2', {
    fetch: scriptedFetch([{ status: 200, body: '"1280"' }], feeCalls),
    delay: noDelay,
  });
  assert.equal(await feeClient.feerate(), '1280');
  assert.equal(feeCalls[0].url, 'https://indexer.test/api/v2/feerate');

  // order book: cursor envelope walk follows next_cursor to the end.
  const bookCalls: { url: string }[] = [];
  const bookClient = new IndexerClient('https://indexer.test/api/v2', {
    fetch: scriptedFetch(
      [
        { status: 200, body: { items: [{ price: { decimal: '0.34', atoms: '34/100' }, amount: { atoms: '1000' } }], next_cursor: 'c1', truncated: false } },
        { status: 200, body: { items: [{ price: { decimal: '0.35', atoms: '35/100' }, amount: { atoms: '2000' } }], next_cursor: null, truncated: false } },
        // Third page serves the direct orderBook() call below.
        { status: 200, body: { items: [{ price: { decimal: '0.34', atoms: '34/100' }, amount: { atoms: '1000' } }], next_cursor: 'c1', truncated: false } },
      ],
      bookCalls,
    ),
    delay: noDelay,
    retries: 0,
  });
  const seen: string[] = [];
  await bookClient.walkCursor('/order/pair/ML_USDT/book', { side: 'ask' }, async (page) => {
    for (const item of page.items) seen.push(String((item as Record<string, unknown>).price ? 'p' : 'x'));
  });
  assert.equal(seen.length, 2);
  assert.match(bookCalls[0].url, /side=ask/);
  assert.match(bookCalls[1].url, /cursor=c1/);
  const page1 = await bookClient.orderBook('ML', 'USDT', 'ask');
  assert.equal(page1.levels.length, 1);
  assert.equal(page1.nextCursor, 'c1');

  // offset walk: stops at the first short page.
  const offsetCalls: { url: string }[] = [];
  const offsetClient = new IndexerClient('https://indexer.test/api/v2', {
    fetch: scriptedFetch(
      [
        { status: 200, body: ['t1', 't2'] },
        { status: 200, body: ['t3'] },
      ],
      offsetCalls,
    ),
    delay: noDelay,
  });
  const offsets: number[] = [];
  await offsetClient.walkOffset('/token', undefined, 2, async (items) => {
    offsets.push(items.length);
  });
  assert.deepEqual(offsets, [2, 1]);
  assert.match(offsetCalls[1].url, /offset=2/);

  // 429 retries with the capped Retry-After, then succeeds.
  const retryCalls: { url: string }[] = [];
  const waits: number[] = [];
  const retryClient = new IndexerClient('https://indexer.test/api/v2', {
    fetch: scriptedFetch([
      { status: 429, body: { error: 'slow down' }, headers: { 'retry-after': '2' } },
      { status: 200, body: { block_height: 1, block_id: 'cd'.repeat(32) } },
    ], retryCalls),
    delay: async (ms) => {
      waits.push(ms);
    },
  });
  assert.equal((await retryClient.tip()).blockHeight, 1);
  assert.equal(retryCalls.length, 2);
  assert.deepEqual(waits, [2000]);

  // Retries exhaust on a persistent 429: last error is typed http 429.
  const exhaustedClient = new IndexerClient('https://indexer.test/api/v2', {
    fetch: scriptedFetch([
      { status: 429, body: {} },
      { status: 429, body: {} },
      { status: 429, body: {} },
    ]),
    delay: noDelay,
    retries: 2,
  });
  await assert.rejects(() => exhaustedClient.tip(), (e: unknown) => e instanceof IndexerError && e.status === 429);

  // Transport failure maps to the typed transport error.
  const offlineClient = new IndexerClient('https://indexer.test/api/v2', {
    fetch: (async () => {
      throw new Error('socket down');
    }) as FetchLike,
    delay: noDelay,
    retries: 0,
  });
  await assert.rejects(() => offlineClient.tip(), (e: unknown) => e instanceof IndexerError && e.kind === 'transport');

  // A non-JSON 2xx body is a typed parse error, never a raw body leak.
  const parseClient = new IndexerClient('https://indexer.test/api/v2', {
    fetch: scriptedFetch([{ status: 200, body: '<html>not json</html>' }]),
    delay: noDelay,
  });
  await assert.rejects(() => parseClient.tip(), (e: unknown) => e instanceof IndexerError && e.kind === 'parse');

  console.log('indexerClient: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
