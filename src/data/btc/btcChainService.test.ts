// BtcChainService gate: Esplora-shaped response parsing and balance stats
// against a scripted offline transport.
//   npx tsx src/data/btc/btcChainService.test.ts
import { strict as assert } from 'node:assert/strict';

import { BtcChainService, type FetchLike } from './BtcChainService';
import { IndexerError } from '../ml/IndexerClient';

function scriptedFetch(responses: { status: number; body: unknown }[]): FetchLike {
  let index = 0;
  const fetch: FetchLike = async (url) => {
    if (index >= responses.length) throw new Error('no scripted response left');
    const response = responses[index++];
    void url;
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      headers: { get: () => null },
      text: async () => JSON.stringify(response.body),
    };
  };
  return fetch;
}

async function main() {
  const client = new BtcChainService('http://localhost:3100/api/bitcoin', {
    fetch: scriptedFetch([
      {
        status: 200,
        body: {
          confirmed: 5438795679,
          unconfirmed: 2500,
          total: 5438798179,
        },
      },
      {
        status: 200,
        body: [
          {
            txid: 'e3bf3d07d4b0375638d5f1db5255fe07ba2c4cb067cd81b84ee974b6585fb468',
            vout: 0,
            status: { confirmed: true, block_height: 363366, block_time: 1435766771 },
            value: 100000000,
          },
        ],
      },
      {
        status: 200,
        body: [
          {
            txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
            fee: 0,
            status: { confirmed: true, block_time: 1231733005 },
            vin: [{ prevout: { scriptpubkey_address: 'bc1qfrom', value: 50000 } }],
            vout: [
              { scriptpubkey_address: 'bc1qto', value: 49000 },
              { scriptpubkey_address: 'bc1qfrom', value: 1000 },
            ],
          },
        ],
      },
      {
        // /txs/mempool serves the same array shape without confirmations.
        status: 200,
        body: [
          {
            txid: 'aaaa4fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
            status: { confirmed: false, block_time: null },
            vin: [{ prevout: { scriptpubkey_address: 'bc1qto', value: 700 } }],
            vout: [{ scriptpubkey_address: 'bc1qtest', value: 700 }],
          },
        ],
      },
      { status: 200, body: { chain_stats: { funded_txo_sum: 100, spent_txo_sum: 40, tx_count: 3 }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 } } },
      { status: 200, body: { confirmed: false, block_time: null } },
      { status: 429, body: {} },
      { status: 200, body: 941320 },
    ]),
    delay: () => Promise.resolve(),
  });

  const balance = await client.balance('bc1qtest');
  assert.deepEqual(balance, { confirmedSat: '5438795679', unconfirmedSat: '2500', totalSat: '5438798179' });

  const utxos = await client.utxos('bc1qtest');
  assert.equal(utxos[0].valueSat, '100000000');
  assert.equal(utxos[0].confirmed, true);
  assert.equal(utxos[0].blockTime, 1435766771);

  const txs = await client.txs('bc1qtest');
  assert.equal(txs[0].feeSat, '0');
  assert.equal(txs[0].vin[0].address, 'bc1qfrom');
  assert.equal(txs[0].vout[1].valueSat, '1000');
  const mempool = await client.txs('bc1qtest', { mempool: true });
  assert.equal(mempool.length, 1);

  const stats = await client.addressStats('bc1qtest');
  assert.deepEqual(stats.chain, { fundedSat: '100', spentSat: '40', txCount: 3 });
  assert.equal(stats.chain.fundedSat, '100');

  const status = await client.txStatus('f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16');
  assert.deepEqual(status, { confirmed: false, blockTime: null });

  // 429 retries with backoff, then the numeric tip height parses.
  assert.equal(await client.tipHeight(), 941320);

  // Typed error on a non-JSON amount.
  const badClient = new BtcChainService('http://localhost:3100/api/bitcoin', {
    fetch: scriptedFetch([{ status: 200, body: { confirmed: '12.5 sat', unconfirmed: 0, total: 0 } }]),
    delay: () => Promise.resolve(),
    retries: 0,
  });
  await assert.rejects(() => badClient.balance('bc1qtest'), (e: unknown) => e instanceof IndexerError && e.kind === 'parse');

  console.log('btcChainService: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
