// Activity, balance and NFT service gate: ML and BTC row mapping, direction
// heuristics against a derived address set, portfolio aggregation and the
// 404-as-fresh and 404-as-non-NFT tolerances. All offline, scripted fetches.
//   npx tsx src/data/activity/activityService.test.ts
import { strict as assert } from 'node:assert/strict';

import { IndexerClient, type FetchLike } from '../ml/IndexerClient';
import { BalanceService } from '../ml/BalanceService';
import { NftService } from '../ml/NftService';
import { ActivityService, mergeNewestFirst, relativeTime } from './ActivityService';
import { BtcChainService, type FetchLike as BtcFetchLike } from '../btc/BtcChainService';

const MY = 'mtc1qme';
const OTHER = 'mtc1qother';
const TX = 'a'.repeat(64);

function indexerFetch(responses: Record<string, unknown>): FetchLike {
  const fetch: FetchLike = async (url) => {
    const path = url.replace(/^https:\/\/indexer\.test\/api\/v2/, '');
    const fixture = responses[path];
    if (fixture === undefined) throw new Error(`no fixture for ${path}`);
    const status = fixture !== null && typeof fixture === 'object' && 'status' in fixture && 'body' in fixture
      ? (fixture as { status: number }).status
      : 200;
    const body = status === 200 ? fixture : (fixture as { body: unknown }).body;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    };
  };
  return fetch;
}

function mlClient(responses: Record<string, unknown>): IndexerClient {
  return new IndexerClient('https://indexer.test/api/v2', { fetch: indexerFetch(responses), delay: () => Promise.resolve() });
}

function btcClient(responses: Record<string, unknown>): BtcChainService {
  const fetch: BtcFetchLike = async (url) => {
    const path = url.replace(/^https:\/\/btc.test\/api\/bitcoin/, '');
    const body = responses[path];
    if (body === undefined) throw new Error(`no fixture for ${path}`);
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    };
  };
  return new BtcChainService('https://btc.test/api/bitcoin', { fetch, delay: () => Promise.resolve() });
}

const USDT_TICKER = 'USDT';
const USDT_DECIMALS = 6;

async function main() {
  const client = mlClient({
    '/address/mtc1qa': {
      coin_balance: { atoms: '1000', decimal: '0.00000001' },
      locked_coin_balance: { atoms: '100', decimal: '0' },
      tokens: [{ token_id: 'mmltk1usdt', amount: { atoms: '2500', decimal: '2.5' } }],
      transaction_history: [],
    },
    '/address/mtc1qb': {
      coin_balance: { atoms: '2300', decimal: '0.000000023' },
      locked_coin_balance: { atoms: '0', decimal: '0' },
      tokens: [
        { token_id: 'mmltk1usdt', amount: { atoms: '500', decimal: '0.5' } },
        { token_id: 'mmltk1nft', amount: { atoms: '1', decimal: '1' } },
      ],
      transaction_history: [],
    },
    '/address/mtc1qc': { status: 404, body: { error: 'AddressNotFound' } },
    '/token/mmltk1usdt': { token_ticker: USDT_TICKER, number_of_decimals: USDT_DECIMALS },
    '/nft/mmltk1nft': {
      name: '"Mojito #1"', ticker: '"MOJ"', owner: null, creator: null,
      media_uri: null, icon_uri: null, description: '"d"', media_hash: '"h"',
    },
    '/nft/mmltk1usdt': { status: 404, body: { error: 'NFT not found' } },
  });

  // Portfolio: sums across addresses, tokens per address, fresh 404 as zero.
  const balance = new BalanceService(client, async () => ['mtc1qa', 'mtc1qb', 'mtc1qc']);
  const portfolio = await balance.portfolio();
  assert.equal(portfolio.coinAtoms, '3300');
  assert.equal(portfolio.lockedCoinAtoms, '100');
  assert.deepEqual(portfolio.tokens, [
    { tokenId: 'mmltk1usdt', atoms: '3000' },
    { tokenId: 'mmltk1nft', atoms: '1' },
  ]);

  // Token metadata: ticker and decimals.
  const meta = await balance.tokenMeta('mmltk1usdt');
  assert.deepEqual(meta, { ticker: USDT_TICKER, decimals: USDT_DECIMALS });

  // NFT identification: probe once, 404 means fungible. Display strings
  // arrive double-encoded upstream; the parse layer strips one quoting
  // level, so the ticker and name here surface unquoted.
  const nft = new NftService(client);
  const ids = await nft.identify(['mmltk1usdt', 'mmltk1nft']);
  assert.deepEqual([...ids], ['mmltk1nft']);
  assert.equal((await nft.metadata('mmltk1nft'))?.name, 'Mojito #1');

  // Decimal-only token amounts: the portfolio must rescale through the
  // cached token metadata decimals instead of counting the leg as zero.
  const decimalClient = mlClient({
    '/address/mtc1qdec': {
      coin_balance: { atoms: '0', decimal: '0' },
      locked_coin_balance: { atoms: '0', decimal: '0' },
      tokens: [{ token_id: 'mmltkdec', amount: { decimal: '1.5' } }],
      transaction_history: [],
    },
    '/token/mmltkdec': { token_ticker: 'DEC', number_of_decimals: 6 },
  });
  const decimalBalance = new BalanceService(decimalClient, async () => ['mtc1qdec']);
  const decimalPortfolio = await decimalBalance.portfolio();
  assert.deepEqual(decimalPortfolio.tokens, [{ tokenId: 'mmltkdec', atoms: '1500000' }]);

  // mergeNewestFirst: rank interleave across per-address newest-first id
  // lists, so a lookup cap cannot crowd out one address behind another's
  // older entries, and ids shared across addresses stay deduped.
  assert.deepEqual(mergeNewestFirst([['a1', 'a2'], ['b1'], ['a1', 'a3']]), ['a1', 'b1', 'a2', 'a3']);
  assert.deepEqual(mergeNewestFirst([]), []);

  // ML activity: send from our address, receive to it, token receive, htlc.
  const now = 1_700_000_000;
  const activityClient = mlClient({
    '/address/mtc1qme': {
      coin_balance: { atoms: '0' },
      locked_coin_balance: { atoms: '0' },
      tokens: [],
      transaction_history: [TX, 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)],
    },
    [`/transaction/${TX}`]: {
      id: TX,
      inputs: [{ input_type: 'Utxo', utxo: { type: 'Transfer', destination: MY, value: { type: 'Coin', amount: { atoms: '5000' } } } }],
      outputs: [
        { type: 'Transfer', destination: OTHER, value: { type: 'Coin', amount: { atoms: '4500' } } },
        { type: 'Transfer', destination: MY, value: { type: 'Coin', amount: { atoms: '400' } } },
      ],
      fee: { atoms: '100' },
      block_id: 'ff'.repeat(32),
      timestamp: String(now - 120),
      confirmations: '3',
    },
    [`/transaction/${'b'.repeat(64)}`]: {
      id: 'b'.repeat(64),
      inputs: [{ input_type: 'Utxo', utxo: { type: 'Transfer', destination: OTHER, value: { type: 'Coin', amount: { atoms: '700' } } } }],
      outputs: [{ type: 'Transfer', destination: MY, value: { type: 'Coin', amount: { atoms: '700' } } }],
      fee: { atoms: '0' },
      block_id: null,
      timestamp: '',
      confirmations: '',
    },
    [`/transaction/${'c'.repeat(64)}`]: {
      id: 'c'.repeat(64),
      inputs: [{ input_type: 'Utxo', utxo: { type: 'Transfer', destination: OTHER, value: { type: 'Coin', amount: { atoms: '10' } } } }],
      outputs: [{ type: 'Transfer', destination: MY, value: { type: 'TokenV1', token_id: 'mmltk1usdt', amount: { atoms: '2500000' } } }],
      fee: { atoms: '10' },
      block_id: 'ee'.repeat(32),
      timestamp: String(now - 7200),
      confirmations: '100',
    },
    [`/transaction/${'d'.repeat(64)}`]: {
      id: 'd'.repeat(64),
      inputs: [{ input_type: 'Utxo', utxo: { type: 'Transfer', destination: MY, value: { type: 'Coin', amount: { atoms: '900' } } } }],
      outputs: [{ type: 'Htlc', destination: OTHER, value: { type: 'Coin', amount: { atoms: '800' } } }],
      fee: { atoms: '100' },
      block_id: 'dd'.repeat(32),
      timestamp: String(now - 40),
      confirmations: '0',
    },
  });
  const activity = new ActivityService({
    ml: {
      client: activityClient,
      addresses: async () => [MY],
      tokenMeta: (tokenId) => balance.tokenMeta(tokenId),
    },
    maxLookups: 10,
  });
  const entries = await activity.entries(10, now);
  assert.equal(entries.length, 4);
  // Pending first, then newest first.
  assert.equal(entries[0].kind, 'receive');
  assert.equal(entries[0].confirmations, null);
  assert.equal(entries[1].kind, 'htlc');
  assert.equal(entries[2].kind, 'send');
  assert.deepEqual([entries[2].amountDecimal, entries[2].symbol], ['0.000000045', 'ML']);
  assert.equal(entries[3].kind, 'receive');
  assert.deepEqual([entries[3].amountDecimal, entries[3].symbol], ['2.5', USDT_TICKER]);

  const rows = await activity.rows(10, now);
  assert.equal(rows[0].live, true);
  assert.equal(rows[0].icon, 'arrow_dn');
  assert.equal(rows[1].icon, 'swap');
  assert.equal(rows[1].tone, 'amber');
  assert.equal(rows[2].sub, '- 0.000000045 ML');
  assert.equal(rows[2].time, '2m');
  assert.equal(rows[2].state, 'Confirmed · 3');
  assert.equal(rows[3].state, 'Confirmed · 100');
  assert.equal(rows[0].time, 'now');

  // BTC activity: send nets out change, receive counts gross inbound.
  const btcActivity = new ActivityService({
    btc: {
      client: btcClient({
        '/address/bc1qme/txs': [
          {
            txid: 'f'.repeat(64),
            fee: 100,
            status: { confirmed: true, block_time: now - 3600 },
            vin: [{ prevout: { scriptpubkey_address: 'bc1qme', value: 5000 } }],
            vout: [
              { scriptpubkey_address: 'bc1qother', value: 3900 },
              { scriptpubkey_address: 'bc1qme', value: 1000 },
            ],
          },
          {
            txid: 'e'.repeat(64),
            status: { confirmed: true, block_time: now - 86400 },
            vin: [{ prevout: { scriptpubkey_address: 'bc1qother', value: 800 } }],
            vout: [{ scriptpubkey_address: 'bc1qme', value: 800 }],
          },
        ],
        '/address/bc1qme/txs/mempool': [
          {
            txid: '0'.repeat(64),
            status: { confirmed: false, block_time: null },
            vin: [{ prevout: { scriptpubkey_address: 'bc1qme', value: 2000 } }],
            vout: [{ scriptpubkey_address: 'bc1qother', value: 2000 }],
          },
        ],
      }),
      addresses: async () => ['bc1qme'],
    },
  });
  const btcEntries = await btcActivity.entries(10, now);
  assert.equal(btcEntries.length, 3);
  assert.equal(btcEntries[0].kind, 'send');
  assert.equal(btcEntries[0].confirmations, null);
  assert.equal(btcEntries[1].amountDecimal, '0.00004');
  assert.equal(btcEntries[2].amountDecimal, '0.000008');
  const btcRows = await btcActivity.rows(3, now);
  assert.equal(btcRows[0].sub, '- 0.00002 BTC');
  assert.equal(btcRows[1].time, '1h');
  assert.equal(btcRows[2].time, '1d');

  // Decimal-only token leg and merge-before-cap: a second address whose
  // newest transaction moves tokens with a decimal-only amount, and a cap
  // that must not crowd it out behind the first address's older entries.
  const MY2 = 'mtc1qme2';
  const TOKEN_TX = '5'.repeat(64);
  const OLD_A = '6'.repeat(64);
  const OLD_B = '7'.repeat(64);
  const mergeClient = mlClient({
    [`/address/${MY2}`]: {
      coin_balance: { atoms: '0' },
      locked_coin_balance: { atoms: '0' },
      tokens: [],
      transaction_history: [TOKEN_TX],
    },
    '/address/mtc1qold': {
      coin_balance: { atoms: '0' },
      locked_coin_balance: { atoms: '0' },
      tokens: [],
      transaction_history: [OLD_A, OLD_B],
    },
    [`/transaction/${TOKEN_TX}`]: {
      id: TOKEN_TX,
      inputs: [{ input_type: 'Utxo', utxo: { type: 'Transfer', destination: OTHER, value: { type: 'Coin', amount: { atoms: '10' } } } }],
      outputs: [{ type: 'Transfer', destination: MY2, value: { type: 'TokenV1', token_id: 'mmltkusdt2', amount: { decimal: '2.5' } } }],
      fee: { atoms: '10' },
      block_id: 'cc'.repeat(32),
      timestamp: String(now - 60),
      confirmations: '1',
    },
    [`/transaction/${OLD_A}`]: {
      id: OLD_A,
      inputs: [{ input_type: 'Utxo', utxo: { type: 'Transfer', destination: OTHER, value: { type: 'Coin', amount: { atoms: '800' } } } }],
      outputs: [{ type: 'Transfer', destination: 'mtc1qold', value: { type: 'Coin', amount: { atoms: '800' } } }],
      fee: { atoms: '0' },
      block_id: 'bb'.repeat(32),
      timestamp: String(now - 300),
      confirmations: '5',
    },
    [`/transaction/${OLD_B}`]: {
      id: OLD_B,
      inputs: [{ input_type: 'Utxo', utxo: { type: 'Transfer', destination: OTHER, value: { type: 'Coin', amount: { atoms: '900' } } } }],
      outputs: [{ type: 'Transfer', destination: 'mtc1qold', value: { type: 'Coin', amount: { atoms: '900' } } }],
      fee: { atoms: '0' },
      block_id: 'aa'.repeat(32),
      timestamp: String(now - 600),
      confirmations: '9',
    },
    '/token/mmltkusdt2': { token_ticker: 'USDT2', number_of_decimals: 6 },
  });
  const mergeActivity = new ActivityService({
    ml: {
      client: mergeClient,
      addresses: async () => ['mtc1qme2', 'mtc1qold'],
      tokenMeta: (tokenId) =>
        mergeClient.token(tokenId).then((info) => ({ ticker: info.ticker, decimals: info.decimals })),
    },
    maxLookups: 2,
  });
  const mergeEntries = await mergeActivity.entries(10, now);
  // Rank 0 of every address precedes rank 1 of any: the capped lookups
  // cover the token receive on the second address, mapped through the
  // metadata decimals ('2.5' at 6 decimals).
  assert.deepEqual(mergeEntries.map((entry) => entry.id), [TOKEN_TX, OLD_A]);
  assert.deepEqual([mergeEntries[0].amountDecimal, mergeEntries[0].symbol], ['2.5', 'USDT2']);

  // relativeTime shapes.
  assert.equal(relativeTime(null, now), 'now');
  assert.equal(relativeTime(now - 30, now), 'now');
  assert.equal(relativeTime(now - 90, now), '1m');
  assert.equal(relativeTime(now - 3600, now), '1h');
  assert.equal(relativeTime(now - 2 * 86400, now), '2d');

  console.log('activityService: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
