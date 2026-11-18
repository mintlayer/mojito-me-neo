// Provider switch self-check: mock mode returns today's fixture shapes;
// real mode answers the fixture seams, and the service gates cover the
// data calls themselves.
//   npx tsx src/data/providers/providers.test.ts
import { strict as assert } from 'node:assert/strict';

import { createProviders, readDataMode } from './index';
import { setNetwork } from '../../config/endpoints';
import { BALANCE } from '../../data';

async function main() {
  // default mode is mock
  assert.equal(readDataMode(), 'mock');

  const providers = createProviders('mock');
  assert.equal(providers.mode, 'mock');

  const portfolio = await providers.data.getPortfolio();
  assert.deepEqual(portfolio, BALANCE);

  const assets = await providers.data.getAssets();
  assert.ok(assets.length >= 1);
  assert.equal(typeof assets[0].sym, 'string');

  const activity = await providers.data.getActivity(2);
  assert.equal(activity.length, 2);

  const market = await providers.data.getMarket('ML/USDT');
  assert.equal(market.pair, 'ML/USDT');

  const snapshots = await providers.data.getPrices(['ML']);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].tokenId, 'ML');

  // Mock mode: an empty NFT gallery until real holdings exist, prices are
  // mock per R1, and the demo-data chip stays honest.
  assert.deepEqual(await providers.data.getNfts(), []);
  assert.equal(providers.pricesAreMock, true);

  const history = await providers.price.getHistory('ML', '1D');
  assert.ok(history.length > 10);
  const candles = await providers.price.getCandles('ML/USDT', '1h');
  assert.equal(candles.length, 90);
  // gap-1 contract: candle money fields are decimal strings, never floats.
  assert.equal(typeof candles[0].o, 'string');
  assert.equal(typeof candles[0].v, 'string');

  const joined = await providers.waitlist.join('user@example.com');
  assert.equal(joined.ok, true);
  const duplicate = await providers.waitlist.join('user@example.com');
  assert.deepEqual(duplicate, { ok: false, reason: 'duplicate' });
  const invalid = await providers.waitlist.join('not-an-email');
  assert.deepEqual(invalid, { ok: false, reason: 'invalid' });

  const broadcast = await providers.broadcast.broadcastMl('deadbeef');
  assert.ok(/^[0-9a-f]{64}$/.test(broadcast.txId));
  assert.deepEqual(await providers.broadcast.getMlStatus(broadcast.txId), { state: 'pending' });
  const btcBroadcast = await providers.broadcast.broadcastBtc('deadbeef');
  assert.ok(/^[0-9a-f]{64}$/.test(btcBroadcast.txId));

  const handle = await providers.bridge.initiate({
    route: 'M2E', token: 'USDT', amount: '500.00', destAddr: '0xabc',
  });
  assert.equal(await providers.bridge.status(handle), 'awaiting-deposit');

  // Real mode constructs lazily (no network, no vault access until a data
  // call), keeps the R1 mock price source and the fixture seams for later
  // milestones; the data calls themselves are covered by the service gates.
  const real = createProviders('real');
  assert.equal(real.mode, 'real');
  assert.equal(real.pricesAreMock, true);
  // btcBase is unconfigured (F13), so Bitcoin is not listed as connected and
  // only Mintlayer counts as an active network.
  assert.deepEqual(await real.data.getNetworks(), ['Mintlayer']);
  assert.equal((await real.data.getMarket('ML/USDT')).pair, 'ML/USDT');
  // Unconfigured testnet base (action item A2): typed offline, no fetch.
  setNetwork('testnet');
  const offline = createProviders('real');
  await assert.rejects(() => offline.data.getPortfolio(), /transport/);
  setNetwork('mainnet');

  console.log('providers: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
