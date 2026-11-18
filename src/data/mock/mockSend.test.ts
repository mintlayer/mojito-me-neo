// Mock send service gate: the demo path runs the same address and amount
// validation as the real service and returns demo-labelled results from the
// mock broadcaster (R3). Offline, Node-run.
//   tsx src/data/mock/mockSend.test.ts
import { strict as assert } from 'node:assert/strict';

import { createMockSend } from './mockSend';
import { createFixtureBroadcastProvider } from './fixtures';
import { SendError } from '../../send/errors';
import { decimalsToAtoms } from '../../money';
import { setNetwork } from '../../config/endpoints';

async function main() {
  setNetwork('mainnet');
  const send = createMockSend({ broadcast: createFixtureBroadcastProvider(), network: 'mainnet' });

  assert.equal(send.canBroadcast('ml'), true, 'the mock broadcaster is the R3 demo path');
  assert.equal(send.canBroadcast('btc'), true);

  // Valid ML address quotes all three tiers with the fixture fee.
  const quote = await send.quoteMl({ to: 'mtc1q82twmwwxa3l2pe26gf0zgghu69jtez3qq2ajqyl', amountDecimal: '1.5', decimals: 11 });
  assert.equal(quote.economy.feeDecimal, '0.00008', 'fixture fee schedule drives the tiers');
  assert.equal(quote.standard.feeDecimal, '0.00012');
  assert.equal(quote.fast.feeDecimal, '0.00024');
  assert.equal(quote.fast.rateIsFallback, true, 'fixture rates are flagged');

  // Shape gate: fixture fees are atom-built, so the BTC decimals never
  // carry float tails or e-notation (the review screen feeds them to
  // decimalsToAtoms, which throws on 'e' strings).
  const btcQuote = await send.quoteBtc({ to: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', amountDecimal: '0.001' });
  for (const tier of ['economy', 'standard', 'fast'] as const) {
    const leg = btcQuote[tier];
    assert.match(leg.feeDecimal, /^\d+(?:\.\d+)?$/, `${tier} feeDecimal is a plain decimal, never e-notation`);
    assert.match(leg.feeAtoms, /^\d+$/, `${tier} feeAtoms is a plain atom string`);
    assert.equal(decimalsToAtoms(leg.feeDecimal, 8), leg.feeAtoms, `${tier} feeDecimal survives the review-screen conversion`);
  }
  assert.equal(btcQuote.economy.feeDecimal, '0.00008', 'the BTC schedule rides the same fixture numbers at sat precision');

  // Foreign-chain and malformed addresses are rejected before broadcasting.
  await assert.rejects(
    () => send.quoteMl({ to: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', amountDecimal: '1', decimals: 11 }),
    (e: unknown) => e instanceof SendError && e.kind === 'invalid-address',
  );
  await assert.rejects(
    () => send.sendMl({ to: 'not-an-address', amountDecimal: '1', decimals: 11, tier: 'standard' }),
    (e: unknown) => e instanceof SendError && e.kind === 'invalid-address',
  );
  await assert.rejects(
    () => send.sendMl({ to: 'mtc1q82twmwwxa3l2pe26gf0zgghu69jtez3qq2ajqyl', amountDecimal: '1.0000000000001', decimals: 11, tier: 'standard' }),
    (e: unknown) => e instanceof SendError,
    'extra precision is rejected, never rounded',
  );

  // The demo completes with a deterministic fake id, labelled demo.
  const first = await send.sendMl({ to: 'mtc1q82twmwwxa3l2pe26gf0zgghu69jtez3qq2ajqyl', amountDecimal: '1.5', decimals: 11, tier: 'standard' });
  const second = await send.sendMl({ to: 'mtc1q82twmwwxa3l2pe26gf0zgghu69jtez3qq2ajqyl', amountDecimal: '1.5', decimals: 11, tier: 'standard' });
  assert.equal(first.demo, true, 'mock results are labelled demo');
  assert.match(first.txId, /^[0-9a-f]{64}$/);
  assert.equal(first.txId, second.txId, 'same params, same fake id');
  assert.notEqual(
    first.txId,
    (await send.sendMl({ to: 'mtc1q82twmwwxa3l2pe26gf0zgghu69jtez3qq2ajqyl', amountDecimal: '2', decimals: 11, tier: 'standard' })).txId,
  );

  const btc = await send.sendBtc({ to: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', amountDecimal: '0.001', tier: 'fast' });
  assert.equal(btc.demo, true);
  assert.equal(btc.kind, 'btc');

  console.log('mockSend.test: ok');
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
