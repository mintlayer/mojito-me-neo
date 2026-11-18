// Real bridge provider gate (spec M4): quotes ride the bridge_v2 fees and
// agents-config routes (per-token to_eth fees, the Mintlayer treasury
// deposit address, m2e confirmations), status maps the backend request
// statuses, and the honest gates hold: E2M unsupported (R5), initiation
// unsupported until the intent encoder and the ML submission route exist
// (R3). Offline over a scripted transport.
//   tsx src/data/providers/bridge.test.ts
import { strict as assert } from 'node:assert/strict';

import { TransportError } from '../transport';
import { BridgeError, createBridgeApiProvider, fixedFeeAmount } from './BridgeProvider';

type ScriptedResponse = { status: number; body: unknown };

function scriptedFetch(responses: Record<string, ScriptedResponse>, calls: string[] = []) {
  const fetch = async (url: string) => {
    calls.push(url);
    const path = url.replace(/^https?:\/\/[^/]+\/api\/v1/, '');
    const response = responses[path];
    if (!response) throw new Error(`no scripted response for ${path}`);
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      headers: { get: () => null },
      text: async () => JSON.stringify(response.body),
    };
  };
  return fetch;
}

const CONFIG = {
  network_type: 'mainnet',
  ml_tokens: { ml: 'mtc1q00' },
  volume_30d: { ml: '1000' },
  ml_deposit_address: 'mtc1qtrea5surydepo5itaddre55mtc1qtrea5surydepo5itaddre55',
  eth_flavor_specific_config: {
    '': {
      bridge_contract_address: '0xbridge',
      m2e: { deposit_tx_required_confirmations: 10 },
    },
  },
};

const FEES = {
  usdt: { to_eth: { fixed_fee: '1', percentage_fee: '0.15%' }, to_ml: { fixed_fee: '1', percentage_fee: '0.15%' } },
  ml: { to_eth: { fixed_fee: '0', percentage_fee: '0%' } },
};

async function main() {
  // Fee math: fixed + amount * pct/100 on exact BigInt scale.
  assert.equal(fixedFeeAmount('1', '0.15', '500'), '1.75');
  assert.equal(fixedFeeAmount('0', '0', '500'), '0');
  assert.equal(fixedFeeAmount('2.5', '1', '100'), '3.5');

  const calls: string[] = [];
  const provider = createBridgeApiProvider({
    base: 'https://api.bridge.mintlayer.org/api/v1',
    fetch: scriptedFetch({ '/agents-config': { status: 200, body: CONFIG }, '/fees': { status: 200, body: FEES } } as never, calls),
    delay: async () => undefined,
  });

  // Quote (M2E): to_eth fees, no fabricated minimum, treasury deposit
  // address from the config, confirmations from the m2e flavor.
  const quote = await provider.quote({ route: 'M2E', token: 'usdt', amount: '500.00', destAddr: '0xabc' });
  assert.equal(quote.feePct, '0.15%');
  assert.equal(quote.feeAmount, '1.75');
  assert.equal(quote.minAmount, null);
  assert.equal(quote.confirmationsRequired, 10);
  assert.equal(quote.destContractOrAddress, CONFIG.ml_deposit_address);
  assert.equal(quote.etaSeconds, undefined, 'the real API reports confirmations, never a fabricated seconds ETA');
  assert.ok(calls.some((url) => url.endsWith('/fees')));
  assert.ok(calls.some((url) => url.endsWith('/agents-config')));

  // E2M is refused typed before any network call (R5 open sub-question).
  await assert.rejects(
    () => provider.quote({ route: 'E2M', token: 'usdt', amount: '1', destAddr: 'mtc1q' }),
    (e: unknown) => e instanceof BridgeError && e.failure === 'unsupported',
  );
  await assert.rejects(() => provider.initiate({ route: 'E2M', token: 'usdt', amount: '1', destAddr: 'mtc1q' }), BridgeError);

  // Initiation (M2E) is honestly gated: no fabricated handle while the
  // deposit intent encoder and the ML submission route are pending.
  await assert.rejects(
    () => provider.initiate({ route: 'M2E', token: 'usdt', amount: '1', destAddr: '0xabc' }),
    (e: unknown) => e instanceof BridgeError && e.failure === 'unsupported',
  );

  // Status mapping over the documented backend statuses.
  const statusFetch = scriptedFetch({
    '/bridge-request/uuid-1': { status: 200, body: { status: 'pending', bridge_request_uuid: 'uuid-1' } },
    '/bridge-request/uuid-2': { status: 200, body: { status: 'processed_by_master' } },
    '/bridge-request/uuid-3': { status: 200, body: { status: 'completed' } },
    '/bridge-request/uuid-4': { status: 200, body: { status: 'failed' } },
    '/bridge-request/uuid-5': { status: 200, body: { status: 'manual' } },
    '/bridge-request/uuid-404': { status: 404, body: { error: 'nf' } },
  } as never);
  const statusProvider = createBridgeApiProvider({ base: 'https://api.bridge.mintlayer.org/api/v1', fetch: statusFetch, delay: async () => undefined });
  const handle = { id: 'uuid-1', createdAt: 0 };
  assert.equal(await statusProvider.status(handle), 'awaiting-deposit');
  assert.equal(await statusProvider.status({ id: 'uuid-2', createdAt: 0 }), 'attesting');
  assert.equal(await statusProvider.status({ id: 'uuid-3', createdAt: 0 }), 'minted');
  assert.equal(await statusProvider.status({ id: 'uuid-4', createdAt: 0 }), 'failed');
  assert.equal(await statusProvider.status({ id: 'uuid-5', createdAt: 0 }), 'attesting', 'manual is operator approval pending, not a failure');
  await assert.rejects(() => statusProvider.status({ id: 'uuid-404', createdAt: 0 }), (e: unknown) => e instanceof BridgeError && e.failure === 'failed');

  // Transport failures map to the typed network class.
  const downProvider = createBridgeApiProvider({
    base: 'https://api.bridge.mintlayer.org/api/v1',
    fetch: async () => {
      throw new TransportError('transport', 'bridge', undefined);
    },
    delay: async () => undefined,
  });
  await assert.rejects(() => downProvider.quote({ route: 'M2E', token: 'usdt', amount: '1', destAddr: 'x' }), (e: unknown) => e instanceof BridgeError && e.failure === 'network');

  // An unconfigured base is typed-disabled, never a silent guess.
  const unconfigured = createBridgeApiProvider({ base: null, fetch: scriptedFetch({} as never), delay: async () => undefined });
  await assert.rejects(() => unconfigured.quote({ route: 'M2E', token: 'usdt', amount: '1', destAddr: 'x' }), (e: unknown) => e instanceof BridgeError && e.failure === 'disabled');

  // Unknown tokens and malformed fee rows are typed failures.
  const badProvider = createBridgeApiProvider({
    base: 'https://api.bridge.mintlayer.org/api/v1',
    fetch: scriptedFetch({ '/agents-config': { status: 200, body: CONFIG }, '/fees': { status: 200, body: { usdt: { to_eth: { fixed_fee: 'x', percentage_fee: 'y' } } } } } as never),
    delay: async () => undefined,
  });
  await assert.rejects(() => badProvider.quote({ route: 'M2E', token: 'usdt', amount: '1', destAddr: 'x' }), (e: unknown) => e instanceof BridgeError && e.failure === 'failed');

  console.log('bridge: ok');
}

main();
