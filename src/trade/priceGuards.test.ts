// Price guard gate (spec M4 testing section): slippage rejection cases,
// minimum fill floor, amount sanity and the swap timelock rule margin.
//   tsx src/trade/priceGuards.test.ts
import { strict as assert } from 'node:assert/strict';

import { checkAmounts, checkMinFill, checkSlippage, checkTimelockRule, DEFAULT_SAFETY_MARGIN } from './priceGuards';

function reason(result: { ok: boolean; reason?: string }): string | null {
  return result.ok ? null : (result.reason ?? 'unknown');
}

async function main() {
  // Amount sanity: both legs must parse positive.
  assert.deepEqual(checkAmounts({ giveDecimal: '100', askDecimal: '10' }), { ok: true });
  assert.equal(reason(checkAmounts({ giveDecimal: '0', askDecimal: '10' })), 'amount');
  assert.equal(reason(checkAmounts({ giveDecimal: 'abc', askDecimal: '10' })), 'amount');
  assert.equal(reason(checkAmounts({ giveDecimal: '-1', askDecimal: '10' })), 'amount');

  // Slippage: a limit within the band passes, drift beyond it rejects.
  assert.deepEqual(checkSlippage({ limitDecimal: '0.3458', midDecimal: '0.3450', maxSlippagePct: 0.5 }), { ok: true });
  assert.equal(reason(checkSlippage({ limitDecimal: '0.40', midDecimal: '0.3450', maxSlippagePct: 1 })), 'slippage');
  assert.equal(reason(checkSlippage({ limitDecimal: '0.25', midDecimal: '0.3450', maxSlippagePct: 1 })), 'slippage');
  // Exactly at the band edge passes (5% of 0.345 = 0.01725; 0.3622 vs mid
  // drifts ~4.99%).
  assert.deepEqual(checkSlippage({ limitDecimal: '0.3622', midDecimal: '0.3450', maxSlippagePct: 5 }), { ok: true });
  assert.equal(reason(checkSlippage({ limitDecimal: 'x', midDecimal: '0.345', maxSlippagePct: 1 })), 'slippage');
  assert.equal(reason(checkSlippage({ limitDecimal: '1', midDecimal: '0', maxSlippagePct: 1 })), 'slippage');

  // Minimum fill: below the floor rejects, at the floor passes.
  assert.deepEqual(checkMinFill({ amountDecimal: '10', minDecimal: '5' }), { ok: true });
  assert.equal(reason(checkMinFill({ amountDecimal: '4.99999999999', minDecimal: '5' })), 'minSize');
  assert.deepEqual(checkMinFill({ amountDecimal: '5', minDecimal: '5' }), { ok: true });
  assert.equal(reason(checkMinFill({ amountDecimal: 'nope', minDecimal: '5' })), 'minSize');

  // Timelock rule (F10): BTC must be shorter; the 2x safety margin is
  // enforced before initiating.
  assert.deepEqual(checkTimelockRule({ mlSeconds: 172800, btcSeconds: 86400 }), { ok: true });
  assert.equal(reason(checkTimelockRule({ mlSeconds: 172800, btcSeconds: 172800 })), 'timelock');
  assert.equal(reason(checkTimelockRule({ mlSeconds: 172800, btcSeconds: 90000 })), 'timelock');
  assert.equal(DEFAULT_SAFETY_MARGIN, 2);
  // An explicit margin of 1 permits equal lengths (the rule floor itself).
  assert.deepEqual(checkTimelockRule({ mlSeconds: 86400, btcSeconds: 86400, margin: 1 }), { ok: true });
  assert.equal(reason(checkTimelockRule({ mlSeconds: 0, btcSeconds: 60 })), 'timelock');

  console.log('priceGuards: ok');
}

main();
