// Address and amount validation gate (spec M3 testing section): published
// vectors for mtc1/tmt1 and bc1/tb1, distinct wrong-chain and wrong-network
// errors, malformed rejection, strict amount parsing. Node-run, offline.
//   tsx src/send/validation.test.ts
import { strict as assert } from 'node:assert/strict';

import { bech32m } from '@scure/base';

import { validateAddress, parseSendAmount, exceedsBalance } from './validation';

// Parity vectors from decisions.md F5 (public test mnemonic, account 0
// receiving index 0) and the BIP84 vector from src/keys/BtcKeyring.test.ts.
const ML_MAINNET = 'mtc1q82twmwwxa3l2pe26gf0zgghu69jtez3qq2ajqyl';
const ML_TESTNET = 'tmt1qyxqfq37rra32sq6zhayqcpjwh4trc07mcfardwt';
const BTC_MAINNET = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const BTC_TESTNET = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';

async function main() {
  // Happy paths per network.
  assert.equal(validateAddress(ML_MAINNET, 'ml', 'mainnet'), null, 'mtc1 on mainnet');
  assert.equal(validateAddress(ML_TESTNET, 'ml', 'testnet'), null, 'tmt1 on testnet');
  assert.equal(validateAddress(BTC_MAINNET, 'btc', 'mainnet'), null, 'bc1 on btc mainnet');
  assert.equal(validateAddress(BTC_TESTNET, 'btc', 'testnet'), null, 'tb1 on btc testnet');

  // Wrong network is distinct, with the expected network named.
  assert.deepEqual(validateAddress(ML_MAINNET, 'ml', 'testnet'), { kind: 'wrongNetwork', expected: 'mainnet' });
  assert.deepEqual(validateAddress(ML_TESTNET, 'ml', 'mainnet'), { kind: 'wrongNetwork', expected: 'testnet' });
  assert.deepEqual(validateAddress(BTC_MAINNET, 'btc', 'testnet'), { kind: 'wrongNetwork', expected: 'btc-mainnet' });
  assert.deepEqual(validateAddress(BTC_TESTNET, 'btc', 'mainnet'), { kind: 'wrongNetwork', expected: 'btc-testnet' });

  // Wrong chain is distinct in both directions.
  assert.deepEqual(validateAddress(BTC_MAINNET, 'ml', 'mainnet'), { kind: 'wrongChain', expected: 'btc' });
  assert.deepEqual(validateAddress(ML_TESTNET, 'btc', 'testnet'), { kind: 'wrongChain', expected: 'ml' });

  // Malformed: checksum corruption, bad length, mixed case, foreign hrps.
  const corrupted = ML_MAINNET.slice(0, -1) + (ML_MAINNET.endsWith('q') ? 'p' : 'q');
  assert.deepEqual(validateAddress(corrupted, 'ml', 'mainnet'), { kind: 'malformed' });
  assert.deepEqual(validateAddress('', 'ml', 'mainnet'), { kind: 'malformed' });
  assert.deepEqual(validateAddress('  ', 'btc', 'mainnet'), { kind: 'malformed' });
  assert.deepEqual(validateAddress('0x9c3FA84B0EE2F71a0c1d8B6F421Bd', 'ml', 'mainnet'), { kind: 'malformed' });
  assert.deepEqual(validateAddress('mtc1qkv9d8t4xu2nx5pqxe2u3a8mw0g7e0a', 'ml', 'mainnet'), { kind: 'malformed' }, 'fake demo address must fail the checksum');
  // Non-pubkeyhash ML shapes (variant byte mismatch) stay malformed for v1.
  const variant = mlVariantAddress();
  assert.deepEqual(validateAddress(variant, 'ml', 'mainnet'), { kind: 'malformed' });
  // Non-P2WPKH BTC shapes: version 1 (taproot) is not spendable by the v1 wallet.
  assert.deepEqual(validateAddress('bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0', 'btc', 'mainnet'), { kind: 'malformed' });
  // Whitespace is trimmed, not rejected.
  assert.equal(validateAddress(` ${ML_TESTNET} `, 'ml', 'testnet'), null);

  // Amount parsing: exact decimal strings only.
  assert.deepEqual(parseSendAmount('1.5', 11), { ok: true, atoms: '150000000000' });
  assert.deepEqual(parseSendAmount('0.00000000001', 11), { ok: true, atoms: '1' });
  assert.deepEqual(parseSendAmount('42', 11), { ok: true, atoms: '4200000000000' });
  assert.deepEqual(parseSendAmount('0.00000001', 8), { ok: true, atoms: '1' }, 'btc dust-level input parses');
  assert.deepEqual(parseSendAmount('0.000000000001', 11), { ok: false, error: 'tooManyDecimals' }, 'extra precision rejected, not rounded');
  for (const bad of ['', ' ', '.5', '5.', '1..2', '1,5', '+1', '-1', '1e5', '0x10', 'abc', '0', '0.0', '1.2.3']) {
    const result = parseSendAmount(bad, 11);
    assert.equal(result.ok, false, `rejected: ${JSON.stringify(bad)}`);
    if (!result.ok) assert.equal(result.error, 'parse', `parse error class for ${JSON.stringify(bad)}`);
  }
  // Zero atoms after parse is a parse error, never a send of nothing.
  assert.deepEqual(parseSendAmount('0.00000000000', 11), { ok: false, error: 'parse' });

  // Balance comparison on BigInt atom strings, hostile inputs count as over.
  assert.equal(exceedsBalance('100', '99'), true);
  assert.equal(exceedsBalance('100', '100'), false);
  assert.equal(exceedsBalance('99', '100'), false);
  assert.equal(exceedsBalance('x', '100'), true);

  console.log('validation.test: ok');
}

/** Bech32m address whose first data word is not the pubkeyhash variant. */
function mlVariantAddress(): string {
  return bech32m.encode('mtc', bech32m.toWords(new Uint8Array([0x02, 0xaa, 0xbb, 0xcc])));
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
