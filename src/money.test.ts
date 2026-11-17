// Money helper gate: roundtrips, formatting edge cases and the no-float
// rules (decisions.md F9 semantics). Runs in the Node gate:
//   npx tsx src/money.test.ts
import { strict as assert } from 'node:assert/strict';

import { ML_DECIMALS, atomsToDecimal, decimalsToAtoms, formatAmount, formatUsd } from './money';

async function main() {
  // Semantics pinned by the JS SDK reference (F9).
  assert.equal(atomsToDecimal('100000000', 8), '1');
  assert.equal(decimalsToAtoms('1', 8), '100000000');
  assert.equal(decimalsToAtoms('1', ML_DECIMALS), '100000000000');
  assert.equal(atomsToDecimal('100000000000', ML_DECIMALS), '1');

  // Zero, sign and trailing-zero handling.
  assert.equal(atomsToDecimal('0', 11), '0');
  assert.equal(atomsToDecimal('000000000000', 11), '0');
  assert.equal(atomsToDecimal('-100000000000', ML_DECIMALS), '-1');
  assert.equal(atomsToDecimal('1500000000000', ML_DECIMALS), '15');
  assert.equal(atomsToDecimal('1000000000', ML_DECIMALS), '0.01');
  assert.equal(decimalsToAtoms('0', 11), '0');
  assert.equal(decimalsToAtoms('-1.5', ML_DECIMALS), '-150000000000');
  assert.equal(decimalsToAtoms('0.01', ML_DECIMALS), '1000000000');

  // Huge magnitudes stay exact (atom strings exceed float precision).
  const hugeAtoms = '123456789012345678901234567890';
  assert.equal(decimalsToAtoms(atomsToDecimal(hugeAtoms, ML_DECIMALS), ML_DECIMALS), hugeAtoms);
  assert.equal(atomsToDecimal(hugeAtoms, 0), hugeAtoms);

  // Tiny magnitudes keep every digit.
  assert.equal(atomsToDecimal('1', ML_DECIMALS), '0.00000000001');
  assert.equal(decimalsToAtoms('0.00000000001', ML_DECIMALS), '1');

  // Rounding half up on excess precision, away from zero.
  assert.equal(decimalsToAtoms('0.000000000005', ML_DECIMALS), '1');
  assert.equal(decimalsToAtoms('0.000000000004', ML_DECIMALS), '0');
  assert.equal(decimalsToAtoms('1.999999999999', ML_DECIMALS), '200000000000');
  assert.equal(atomsToDecimal('1', 0), '1');

  // Roundtrip property over a spread of atom strings.
  const samples = [
    '1', '11', '100000000000', '99999999999', '12345678901234567890',
    '5', '1000000000', '99999999999999999999',
  ];
  for (const atoms of samples) {
    assert.equal(decimalsToAtoms(atomsToDecimal(atoms, ML_DECIMALS), ML_DECIMALS), atoms, atoms);
  }

  // Amount display: grouping and fraction caps.
  assert.equal(formatAmount('12480.5'), '12,480.5');
  assert.equal(formatAmount('58880.04', { maxFrac: 2, trimZeros: false }), '58,880.04');
  assert.equal(formatAmount('1234567.891', { maxFrac: 2 }), '1,234,567.89');
  assert.equal(formatAmount('9.999', { maxFrac: 2 }), '10');
  assert.equal(formatAmount('0.999', { maxFrac: 2 }), '1');
  assert.equal(formatAmount('0'), '0');
  // A negative amount that rounds to zero never renders as '-0'.
  assert.equal(formatAmount('-0.000000000001', { maxFrac: 4 }), '0');
  assert.equal(formatAmount('-1.5', { maxFrac: 2 }), '-1.5');
  assert.equal(formatAmount('1000', { maxFrac: 0 }), '1,000');

  // USD display.
  assert.equal(formatUsd('1234.5'), '$1,234.50');
  assert.equal(formatUsd('0', { compact: true }), '$0');
  assert.equal(formatUsd('1234567.8', { compact: true }), '$1.2M');
  assert.equal(formatUsd('12345.6', { compact: true }), '$12.3K');
  assert.equal(formatUsd('999.999', { compact: true }), '$1,000.00');

  // Invalid inputs are rejected loudly, never silently coerced.
  assert.throws(() => decimalsToAtoms('1e9', 11), /not an exact decimal/);
  assert.throws(() => atomsToDecimal('1.5', 11), /not an atom string/);
  assert.throws(() => formatAmount('abc'), /not an exact decimal/);

  console.log('money: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
