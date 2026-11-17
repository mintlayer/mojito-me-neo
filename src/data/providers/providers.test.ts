// Provider switch self-check: mock mode returns today's fixture shapes and
// real mode refuses loudly (nothing silently pretends to work).
//   npx tsx src/data/providers/providers.test.ts
import { strict as assert } from 'node:assert/strict';

import { createProviders, readDataMode } from './index';
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

  const history = await providers.price.getHistory('ML', '1D');
  assert.ok(history.length > 10);
  const candles = await providers.price.getCandles('ML/USDT', '1h');
  assert.equal(candles.length, 90);

  const joined = await providers.waitlist.join('user@example.com');
  assert.equal(joined.ok, true);
  const duplicate = await providers.waitlist.join('user@example.com');
  assert.deepEqual(duplicate, { ok: false, reason: 'duplicate' });
  const invalid = await providers.waitlist.join('not-an-email');
  assert.deepEqual(invalid, { ok: false, reason: 'invalid' });

  const broadcast = await providers.broadcast.broadcastMl('deadbeef');
  assert.ok(/^[0-9a-f]{64}$/.test(broadcast.txId));
  assert.equal(await providers.broadcast.getMlStatus(broadcast.txId), 'pending');

  const handle = await providers.bridge.initiate({
    route: 'M2E', token: 'USDT', amount: '500.00', destAddr: '0xabc',
  });
  assert.equal(await providers.bridge.status(handle), 'awaiting-deposit');

  // real mode is gated until M2
  assert.throws(() => createProviders('real'), /not-implemented/);

  console.log('providers: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
