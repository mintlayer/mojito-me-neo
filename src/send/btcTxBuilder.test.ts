// BTC send gate (spec M3 testing section): build and sign a P2WPKH
// transaction with the BIP84 published vector keys (bip-0084.mediawiki
// vector 1, the same vectors pinned in src/keys/BtcKeyring.test.ts), verify
// the signed bytes parse with the expected outputs and fee, and the typed
// dust and insufficient-funds rejections. Node-run, offline; fee sizing is
// deterministic through the injected rate source.
//   tsx src/send/btcTxBuilder.test.ts
import { strict as assert } from 'node:assert/strict';

import { HDKey } from '@scure/bip32';
import { NETWORK, Transaction, p2wpkh } from '@scure/btc-signer';

import { deriveBtcAccount } from '../keys/BtcKeyring';
import type { BtcUtxo } from '../data/btc/BtcChainService';
import { mnemonicToSeedSync } from '../keys/bip39';
import { BtcTxBuilder, BTC_DUST_SAT } from './BtcTxBuilder';
import { SendError } from './errors';

// Published BIP84 vector 1 (bip-0084.mediawiki): 12-word mnemonic, first
// account m/84'/0'/0'. Addresses match src/keys/BtcKeyring.test.ts.
const VECTOR_12 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' ');
const BIP84_RECEIVING_0 = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const BIP84_RECEIVING_1 = 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g';
const BIP84_CHANGE_0 = 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el';

const TXID_A = '11'.repeat(32);
const TXID_B = '22'.repeat(32);

function utxo(txid: string, vout: number, valueSat: string, confirmed = true): BtcUtxo {
  return { txid, vout, valueSat, confirmed, blockTime: null };
}

function builderFor(funded: Record<string, BtcUtxo[]>, rate: { satPerVbyte: number; fallback: boolean }, changeAddress: string): BtcTxBuilder {
  return new BtcTxBuilder({
    network: 'mainnet',
    utxos: { async utxos(address) { return funded[address] ?? []; } },
    rateSource: async () => rate,
    changeAddress,
  });
}

async function main() {
  const account = await deriveBtcAccount(VECTOR_12, 'mainnet');
  assert.equal(account.xpub.length > 0, true);
  const seed = mnemonicToSeedSync(VECTOR_12);
  const walk = HDKey.fromExtendedKey(account.xpub);
  const addressAt = (branch: 0 | 1, index: number): string => {
    const pay = p2wpkh(walk.derive(`m/${branch}/${index}`).publicKey!, NETWORK);
    if (pay.address === undefined) throw new Error('vector derivation failed');
    return pay.address;
  };

  // 1. Plan and sign one input at 1 sat/vB, sending back to the change
  //    address so the vector addresses pin both legs.
  {
    const builder = builderFor({ [BIP84_RECEIVING_0]: [utxo(TXID_A, 0, '100000')] }, { satPerVbyte: 1, fallback: false }, BIP84_CHANGE_0);
    const plan = await builder.plan({
      accountXpub: account.xpub,
      fromAddresses: [BIP84_RECEIVING_0],
      to: BIP84_CHANGE_0,
      amountSat: 40000n,
      tier: 'standard',
    });
    // One P2WPKH input, two outputs, 1 sat/vB: the scure estimator reports
    // the exact vsize; the fee must equal rate * vsize.
    assert.equal(BigInt(plan.feeSat), BigInt(plan.vsize) * 1n, 'fee equals rate times vsize');
    assert.equal(plan.rateIsFallback, false);
    assert.equal(plan.inputSat, '100000');
    assert.equal(BigInt(plan.changeSat), 100000n - 40000n - BigInt(plan.feeSat));

    const result = await builder.buildAndSign({
      seed,
      accountXpub: account.xpub,
      fromAddresses: [BIP84_RECEIVING_0],
      to: BIP84_CHANGE_0,
      amountSat: 40000n,
      tier: 'standard',
    });
    // The signed bytes must parse back with the exact recipient, amount and
    // fee; the implicit invariant sum(inputs) - sum(outputs) = fee holds.
    const parsed = Transaction.fromRaw(new Uint8Array(Buffer.from(result.hex, 'hex')));
    assert.equal(parsed.outputsLength, 2);
    assert.equal(parsed.getOutputAddress(0), BIP84_CHANGE_0, 'recipient leg lands on the requested address');
    assert.equal(parsed.getOutput(0)?.amount, 40000n);
    assert.equal(parsed.getOutputAddress(1), BIP84_CHANGE_0, 'change leg lands on the change address');
    const outputsSum = ((parsed.getOutput(0)?.amount ?? 0n) + (parsed.getOutput(1)?.amount ?? 0n)).toString();
    assert.equal((BigInt(plan.inputSat) - BigInt(outputsSum)).toString(), result.feeSat, 'inputs minus outputs equals fee');
    assert.equal(result.feeSat, plan.feeSat, 'signed fee matches the reviewed plan');
    assert.equal(result.txid, parsed.id);
    assert.match(result.txid, /^[0-9a-f]{64}$/);
    assert.equal(result.vsize, plan.vsize);
    assert.equal(result.rateSatPerVbyte, '1');
    assert.equal(result.sentSat, '40000');

    // Deterministic signing (RFC6979): same inputs, same signature bytes.
    const again = await builderFor({ [BIP84_RECEIVING_0]: [utxo(TXID_A, 0, '100000')] }, { satPerVbyte: 1, fallback: false }, BIP84_CHANGE_0).buildAndSign({
      seed,
      accountXpub: account.xpub,
      fromAddresses: [BIP84_RECEIVING_0],
      to: BIP84_CHANGE_0,
      amountSat: 40000n,
      tier: 'standard',
    });
    assert.equal(again.hex, result.hex);
    assert.equal(again.txid, result.txid);
  }

  // 2. Recipient on a different receiving index: the input key must be the
  //    one the xpub walk maps for that address (finalize fails otherwise).
  {
    const builder = builderFor({ [BIP84_RECEIVING_1]: [utxo(TXID_A, 1, '80000')] }, { satPerVbyte: 2, fallback: false }, BIP84_CHANGE_0);
    const result = await builder.buildAndSign({
      seed,
      accountXpub: account.xpub,
      fromAddresses: [BIP84_RECEIVING_1],
      to: BIP84_RECEIVING_0,
      amountSat: 30000n,
      tier: 'fast',
    });
    const parsed = Transaction.fromRaw(new Uint8Array(Buffer.from(result.hex, 'hex')));
    assert.equal(parsed.getOutputAddress(0), BIP84_RECEIVING_0);
    assert.equal(BigInt(result.feeSat), BigInt(result.vsize) * 2n, 'fee follows the fast tier rate');
    // Cannot be the same transaction as the index-0 input spend.
    assert.notEqual(result.txid, TXID_A);
  }

  // 3. Two inputs when one cannot cover the send.
  {
    const builder = builderFor(
      { [BIP84_RECEIVING_0]: [utxo(TXID_A, 0, '60000'), utxo(TXID_B, 0, '60000')] },
      { satPerVbyte: 1, fallback: false },
      BIP84_CHANGE_0,
    );
    const result = await builder.buildAndSign({
      seed,
      accountXpub: account.xpub,
      fromAddresses: [BIP84_RECEIVING_0],
      to: BIP84_CHANGE_0,
      amountSat: 100000n,
      tier: 'standard',
    });
    const parsed = Transaction.fromRaw(new Uint8Array(Buffer.from(result.hex, 'hex')));
    assert.equal(parsed.inputsLength, 2, 'both utxos selected');
    const inputSum = 120000n;
    const outputSum = (parsed.getOutput(0)?.amount ?? 0n) + (parsed.getOutput(1)?.amount ?? 0n);
    assert.equal(inputSum - outputSum, BigInt(result.feeSat));
  }

  // 4. Fallback rate flag rides the plan.
  {
    const builder = builderFor({ [BIP84_RECEIVING_0]: [utxo(TXID_A, 0, '100000')] }, { satPerVbyte: 10, fallback: true }, BIP84_CHANGE_0);
    const plan = await builder.plan({
      accountXpub: account.xpub,
      fromAddresses: [BIP84_RECEIVING_0],
      to: BIP84_CHANGE_0,
      amountSat: 40000n,
      tier: 'economy',
    });
    assert.equal(plan.rateIsFallback, true, 'fixed fallback is flagged');
    assert.equal(BigInt(plan.feeSat), BigInt(plan.vsize) * 10n);
  }

  // 5. Insufficient funds is typed.
  {
    const builder = builderFor({ [BIP84_RECEIVING_0]: [utxo(TXID_A, 0, '100000')] }, { satPerVbyte: 1, fallback: false }, BIP84_CHANGE_0);
    await assert.rejects(
      () =>
        builder.buildAndSign({
          seed,
          accountXpub: account.xpub,
          fromAddresses: [BIP84_RECEIVING_0],
          to: BIP84_CHANGE_0,
          amountSat: 200000n,
          tier: 'standard',
        }),
      (e: unknown) => e instanceof SendError && e.kind === 'insufficient-funds',
    );
  }

  // 6. Dust is typed, before any UTXO fetch.
  {
    const builder = builderFor({}, { satPerVbyte: 1, fallback: false }, BIP84_CHANGE_0);
    await assert.rejects(
      () =>
        builder.buildAndSign({
          seed,
          accountXpub: account.xpub,
          fromAddresses: [BIP84_RECEIVING_0],
          to: BIP84_CHANGE_0,
          amountSat: BTC_DUST_SAT - 1n,
          tier: 'standard',
        }),
      (e: unknown) => e instanceof SendError && e.kind === 'dust',
    );
    await assert.rejects(
      () =>
        builder.buildAndSign({
          seed,
          accountXpub: account.xpub,
          fromAddresses: [BIP84_RECEIVING_0],
          to: BIP84_CHANGE_0,
          amountSat: BTC_DUST_SAT,
          tier: 'standard',
        }),
      (e: unknown) => e instanceof SendError && e.kind === 'insufficient-funds',
      'at the dust floor the empty fixture wallet still fails as insufficient',
    );
  }

  // 7. Foreign wallet address rejects before signing.
  {
    const foreignAccount = await deriveBtcAccount([...Array(23).fill('abandon'), 'art'], 'mainnet');
    const builder = builderFor({ [BIP84_RECEIVING_0]: [utxo(TXID_A, 0, '100000')] }, { satPerVbyte: 1, fallback: false }, BIP84_CHANGE_0);
    await assert.rejects(
      () =>
        builder.buildAndSign({
          seed,
          accountXpub: foreignAccount.xpub,
          fromAddresses: [BIP84_RECEIVING_0],
          to: BIP84_CHANGE_0,
          amountSat: 40000n,
          tier: 'standard',
        }),
      (e: unknown) => e instanceof SendError && e.kind === 'rejected',
    );
  }

  // 8. Two funded origins (receiving 0 and change 0): the send spends both
  //    and the change lands on a fresh branch 1 address, so the second send
  //    of a real wallet flow keeps every UTXO reachable.
  {
    const freshChange = addressAt(1, 1);
    assert.notEqual(freshChange, BIP84_CHANGE_0, 'the fresh change address is a different branch 1 index');
    const builder = builderFor(
      { [BIP84_RECEIVING_0]: [utxo(TXID_A, 0, '60000')], [BIP84_CHANGE_0]: [utxo(TXID_B, 0, '60000')] },
      { satPerVbyte: 1, fallback: false },
      freshChange,
    );
    const result = await builder.buildAndSign({
      seed,
      accountXpub: account.xpub,
      fromAddresses: [BIP84_RECEIVING_0, BIP84_CHANGE_0],
      to: BIP84_RECEIVING_1,
      amountSat: 100000n,
      tier: 'standard',
    });
    const parsed = Transaction.fromRaw(new Uint8Array(Buffer.from(result.hex, 'hex')));
    assert.equal(parsed.inputsLength, 2, 'both funded origins are selected');
    // BIP69 orders outputs by amount ascending, so match legs by value.
    const legs = [0, 1].map((i) => ({ address: parsed.getOutputAddress(i), amount: parsed.getOutput(i)?.amount ?? 0n }));
    assert.deepEqual(
      legs.map((l) => l.address).sort(),
      [BIP84_RECEIVING_1, freshChange].sort(),
      'recipient and fresh branch 1 change legs are both present',
    );
    assert.equal(legs.find((l) => l.address === BIP84_RECEIVING_1)?.amount, 100000n, 'recipient amount is exact');
    assert.equal(legs.find((l) => l.address === freshChange)?.amount, 120000n - 100000n - BigInt(result.feeSat));
    assert.equal(BigInt(result.feeSat), BigInt(result.vsize) * 1n);
    // The mixed-origin transaction must be valid: signing with one shared
    // origin (the pre-fix behavior) fails to finalize here.
    assert.match(result.txid, /^[0-9a-f]{64}$/);
  }

  // 9. An unconfirmed external receipt (receiving branch) is not spendable
  //    until it confirms (header policy): it filters out before selection.
  {
    const builder = builderFor({ [BIP84_RECEIVING_0]: [utxo(TXID_A, 0, '100000', false)] }, { satPerVbyte: 1, fallback: false }, BIP84_CHANGE_0);
    await assert.rejects(
      () =>
        builder.buildAndSign({
          seed,
          accountXpub: account.xpub,
          fromAddresses: [BIP84_RECEIVING_0],
          to: BIP84_CHANGE_0,
          amountSat: 40000n,
          tier: 'standard',
        }),
      (e: unknown) => e instanceof SendError && e.kind === 'insufficient-funds',
      'unconfirmed external receipt stays out of coin selection',
    );
  }

  // 10. Own unconfirmed change (change branch) is spendable by policy: it
  //     is the back to back send case, documented in the module header.
  {
    const builder = builderFor({ [BIP84_CHANGE_0]: [utxo(TXID_A, 0, '100000', false)] }, { satPerVbyte: 1, fallback: false }, BIP84_CHANGE_0);
    const result = await builder.buildAndSign({
      seed,
      accountXpub: account.xpub,
      fromAddresses: [BIP84_CHANGE_0],
      to: BIP84_RECEIVING_0,
      amountSat: 40000n,
      tier: 'standard',
    });
    const parsed = Transaction.fromRaw(new Uint8Array(Buffer.from(result.hex, 'hex')));
    assert.equal(parsed.inputsLength, 1);
    assert.equal(parsed.getOutputAddress(0), BIP84_RECEIVING_0);
  }

  // 11. The origin walk follows the injected persisted counters: a change
  //     address above the fixed 512 ceiling maps and stays spendable (the
  //     long send history case), while without the counters the same
  //     wallet fails closed instead of spending an unmapped input.
  {
    const changeHigh = addressAt(1, 600);
    const freshChange = addressAt(1, 601);
    const funded = { [changeHigh]: [utxo(TXID_A, 0, '100000')] };
    const rate = { satPerVbyte: 1, fallback: false };
    await assert.rejects(
      () => builderFor(funded, rate, freshChange).buildAndSign({
        seed,
        accountXpub: account.xpub,
        fromAddresses: [changeHigh],
        to: BIP84_RECEIVING_0,
        amountSat: 40000n,
        tier: 'standard',
      }),
      (e: unknown) => e instanceof SendError && e.kind === 'rejected',
      'without the counters the walk ceiling keeps the address unmapped',
    );
    const builder = new BtcTxBuilder({
      network: 'mainnet',
      utxos: { async utxos(address) { return funded[address] ?? []; } },
      rateSource: async () => rate,
      changeAddress: freshChange,
      walkCounters: async () => ({ receiving: 0, change: 600 }),
    });
    const result = await builder.buildAndSign({
      seed,
      accountXpub: account.xpub,
      fromAddresses: [changeHigh],
      to: BIP84_RECEIVING_0,
      amountSat: 40000n,
      tier: 'standard',
    });
    const parsed = Transaction.fromRaw(new Uint8Array(Buffer.from(result.hex, 'hex')));
    assert.equal(parsed.inputsLength, 1, 'the change UTXO above the fixed ceiling is selected');
    assert.equal(parsed.getOutputAddress(0), BIP84_RECEIVING_0);
  }

  console.log('btcTxBuilder.test: ok');
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
