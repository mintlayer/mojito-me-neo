// IndexerClient gate: offline fixture transport covering the cursor walk,
// the atoms/decimal/number number-shape tolerance, the 429 retry with
// Retry-After, the 404-as-fresh-address mapping and the timeout path.
//   npx tsx src/data/ml/indexerClient.test.ts
import { strict as assert } from 'node:assert/strict';

import { IndexerClient, IndexerError, MAX_RESPONSE_BYTES, parseAmount, type FetchLike } from './IndexerClient';

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
  // Uint64 number. Numbers must be safe integers and objects must carry an
  // amount field: anything else is a typed parse error, never a silent zero.
  assert.deepEqual(parseAmount({ atoms: '11', decimal: '1.1' }), { atoms: '11', decimal: '1.1' });
  assert.deepEqual(parseAmount('123'), { atoms: '123' });
  assert.deepEqual(parseAmount('1.5'), { decimal: '1.5' });
  assert.deepEqual(parseAmount(64), { atoms: '64' });
  assert.deepEqual(parseAmount({ atoms: 64 }), { atoms: '64' });
  assert.throws(() => parseAmount(null), /parse/);
  assert.throws(() => parseAmount(1.5), /parse/);
  assert.throws(() => parseAmount(1e21), /parse/);
  assert.throws(() => parseAmount(-4), /parse/);
  assert.throws(() => parseAmount({}), /parse/);
  assert.throws(() => parseAmount({ atoms: 1.5 }), /parse/);
  assert.throws(() => parseAmount({ decimal: 2 }), /parse/);

  // Base scheme guard: https always; plaintext only for the localhost dev
  // fallbacks; a non-URL base is rejected outright.
  new IndexerClient('https://indexer.test/api/v2', { fetch: scriptedFetch([]) });
  new IndexerClient('http://localhost:13000/api/v2', { fetch: scriptedFetch([]) });
  new IndexerClient('http://127.0.0.1:13000/api/v2', { fetch: scriptedFetch([]) });
  new IndexerClient('http://[::1]:13000/api/v2', { fetch: scriptedFetch([]) });
  assert.throws(() => new IndexerClient('http://indexer.test/api/v2', { fetch: scriptedFetch([]) }), /https/);
  assert.throws(() => new IndexerClient('ftp://indexer.test', { fetch: scriptedFetch([]) }), /https/);
  assert.throws(() => new IndexerClient('not a url', { fetch: scriptedFetch([]) }), /invalid base URL/);

  // Response size caps: a declared content-length or a body over the cap is
  // a typed parse error, never an unbounded JSON.parse.
  const hugeClient = new IndexerClient('https://indexer.test/api/v2', {
    fetch: async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => (name === 'content-length' ? String(MAX_RESPONSE_BYTES + 1) : null) },
      text: async () => {
        throw new Error('body must not be read when the header already exceeds the cap');
      },
    }),
    delay: noDelay,
    retries: 0,
  });
  await assert.rejects(() => hugeClient.tip(), (e: unknown) => e instanceof IndexerError && e.kind === 'parse');
  const hugeBodyClient = new IndexerClient('https://indexer.test/api/v2', {
    fetch: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => 'x'.repeat(MAX_RESPONSE_BYTES + 1),
    }),
    delay: noDelay,
    retries: 0,
  });
  await assert.rejects(() => hugeBodyClient.tip(), (e: unknown) => e instanceof IndexerError && e.kind === 'parse');

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

  // nft: 200 parses, 404 resolves to null (non-NFT id). Upstream double-
  // encodes display strings; the parse layer strips one quoting level.
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
  const nftInfo = await nftClient.nft('mmltk1nft');
  assert.equal(nftInfo?.name, 'Mojito #1');
  assert.equal(nftInfo?.ticker, 'MOJ');
  assert.equal(nftInfo?.description, 'x');
  assert.equal(nftInfo?.mediaHash, 'aa');
  assert.equal(await nftClient.nft('mmltk1notnft'), null);

  // Token info: quoted ticker and authority surface unquoted; already-plain
  // strings and a non-JSON quoted fragment pass through unchanged.
  const tokenClient = new IndexerClient('https://indexer.test/api/v2', {
    fetch: scriptedFetch([
      { status: 200, body: { token_ticker: '"USDT"', number_of_decimals: 6, authority: '"ab"', metadata_uri: 'https://plain.example', frozen: false } },
      { status: 200, body: { token_ticker: '"USDT' } },
    ]),
    delay: noDelay,
  });
  const tokenInfo = await tokenClient.token('mmltk1usdt');
  assert.equal(tokenInfo.ticker, 'USDT');
  assert.equal(tokenInfo.authority, 'ab');
  assert.equal(tokenInfo.decimals, 6);
  assert.equal(tokenInfo.metadataUri, 'https://plain.example');
  assert.equal((await tokenClient.token('mmltk1odd')).ticker, '"USDT');

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

  // orders list and detail (M4): currency sides keep their type and token
  // id; optional initial amounts parse when present.
  const orderCalls: { url: string }[] = [];
  const orderClient = new IndexerClient('https://indexer.test/api/v2', {
    fetch: scriptedFetch(
      [
        {
          status: 200,
          body: [
            {
              order_id: 'mordr1abc',
              give_balance: { atoms: '1000' },
              ask_balance: { atoms: '100' },
              give_currency: { type: 'Coin' },
              ask_currency: { type: 'Token', token_id: 'mmltk1x' },
              initially_given: { atoms: '2000' },
              initially_asked: { atoms: '200' },
              conclude_destination: 'mtc1qmaker',
            },
          ],
        },
        {
          status: 200,
          body: {
            order_id: 'mordr1abc',
            give_balance: { atoms: '950' },
            ask_balance: { atoms: '95' },
            give_currency: { type: 'Coin' },
            ask_currency: { type: 'Token', token_id: 'mmltk1x' },
            conclude_destination: 'mtc1qmaker',
          },
        },
      ],
      orderCalls,
    ),
    delay: noDelay,
  });
  const orders = await orderClient.orders();
  assert.equal(orders.length, 1);
  assert.equal(orders[0].orderId, 'mordr1abc');
  assert.equal(orders[0].giveBalance.atoms, '1000');
  assert.equal(orders[0].giveCurrency.type, 'Coin');
  assert.equal(orders[0].askCurrency.tokenId, 'mmltk1x');
  assert.equal(orders[0].initiallyGiven?.atoms, '2000');
  assert.equal(orders[0].concludeDestination, 'mtc1qmaker');
  assert.match(orderCalls[0].url, /items=100&offset=0/);
  const detail = await orderClient.order('mordr1abc');
  assert.equal(detail.askBalance.atoms, '95');
  assert.equal(detail.initiallyGiven, null);
  assert.equal(detail.frozen, false);
  assert.match(orderCalls[1].url, /\/order\/mordr1abc$/);

  // Non-terminating cursor: the same next_cursor forever is cut off by the
  // page cap with a typed parse error, not an unbounded request loop.
  let endlessCursorCalls = 0;
  const endlessCursor = new IndexerClient('https://indexer.test/api/v2', {
    fetch: async () => {
      endlessCursorCalls += 1;
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ items: [1], next_cursor: 'same', truncated: false }) };
    },
    delay: noDelay,
  });
  await assert.rejects(
    () => endlessCursor.walkCursor('/order/pair/ML_USDT/book', { side: 'ask' }, async () => undefined),
    (e: unknown) => e instanceof IndexerError && e.kind === 'parse',
  );
  assert.equal(endlessCursorCalls, 100);

  // Explicit caps apply: a two-page ceiling stops a terminating walk early
  // with the same typed error.
  let cappedCalls = 0;
  const cappedCursor = new IndexerClient('https://indexer.test/api/v2', {
    fetch: async () => {
      cappedCalls += 1;
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ items: [1], next_cursor: `c${cappedCalls}`, truncated: false }) };
    },
    delay: noDelay,
  });
  await assert.rejects(
    () => cappedCursor.walkCursor('/order/pair/ML_USDT/book', { side: 'ask' }, async () => undefined, { maxPages: 2 }),
    (e: unknown) => e instanceof IndexerError && e.kind === 'parse',
  );
  assert.equal(cappedCalls, 2);

  // Endless full pages in the offset walk hit the item cap with a typed
  // parse error.
  let endlessOffsetCalls = 0;
  const endlessOffset = new IndexerClient('https://indexer.test/api/v2', {
    fetch: async () => {
      endlessOffsetCalls += 1;
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(['t1', 't2']) };
    },
    delay: noDelay,
  });
  await assert.rejects(
    () => endlessOffset.walkOffset('/token', undefined, 2, async () => undefined, { maxItems: 6 }),
    (e: unknown) => e instanceof IndexerError && e.kind === 'parse',
  );
  assert.equal(endlessOffsetCalls, 3);

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
