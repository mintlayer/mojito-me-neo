// ML build and sign gate (spec M3 testing section): deterministic fixture
// UTXOs, single input, change split, fee rounding, insufficient funds and
// the token transfer variant, plus the signer loopback over a recording
// bindings double. Node-run, offline: the real bindings reject without the
// native call-through, so the pipeline is verified against the
// MintlayerBindings interface contract and the derivation parity vectors.
//   tsx src/send/mlTxBuilder.test.ts
import { strict as assert } from 'node:assert/strict';

import { bytesToHex } from '@noble/hashes/utils.js';
import { hex } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';

import type { MintlayerBindings, WitnessParams } from '../../modules/mojito-core';
import type { MlUtxo } from '../data/ml/types';
import { deriveMlAccount, mlAddressAt, mlPrivateKeyFromSeed, mlXpubFromSeed } from '../keys/mlAccounts';
import { mnemonicToSeed } from '../keys/bip39';
import type { KeySession } from '../keys/session';
import { ML_DECIMALS } from '../money';
import { MlTxBuilder, mlFeeAtoms, selectMlInputs } from './MlTxBuilder';
import { MlTxSigner } from './MlTxSigner';
import { SendError } from './errors';

// Public test vector (decisions.md F5): abandon x23 + art, mainnet account 0.
const VECTOR_WORDS = [...Array(23).fill('abandon'), 'art'];
const VECTOR_ADDRESS = 'mtc1q82twmwwxa3l2pe26gf0zgghu69jtez3qq2ajqyl';

const TOKEN_ID = 'tMLTK10test000000000000000000000000000000000';

const ML = 10n ** BigInt(ML_DECIMALS);

function atoms(ml: bigint): string {
  return (ml * ML).toString();
}

/** Deterministic bindings double: encodings are tagged byte strings whose
 *  layout the tests parse back; sizes are a linear function of inputs and
 *  outputs so the fee rule is exactly predictable. */
function fakeBindings(): MintlayerBindings & { witnesses: WitnessParams[]; sizes: number[] } {
  const witnesses: WitnessParams[] = [];
  const sizes: number[] = [];
  const u32 = (value: number): Uint8Array => {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, value, false);
    return out;
  };
  const cat = (...parts: Uint8Array[]): Uint8Array => {
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  };
  const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
  return {
    witnesses,
    sizes,
    async encodeOutpointSourceId(id32: Uint8Array) {
      return cat(new Uint8Array([0x01]), id32);
    },
    async encodeInputForUtxo(outpointSource: Uint8Array, index: number) {
      return cat(new Uint8Array([0x02]), outpointSource, u32(index));
    },
    async encodeOutputTransfer(atomsStr: string, address: string) {
      return utf8(`T:${atomsStr}:${address}`);
    },
    async encodeOutputTokenTransfer(tokenId: string, atomsStr: string, address: string) {
      return utf8(`K:${tokenId}:${atomsStr}:${address}`);
    },
    async encodeTransaction(inputs: Uint8Array[], outputs: Uint8Array[]) {
      return cat(new Uint8Array([0xee, inputs.length]), ...inputs, new Uint8Array([0xff, outputs.length]), ...outputs);
    },
    async estimateTransactionSize(inputs: Uint8Array[], destinations: string[], outputs: Uint8Array[]) {
      const size = 80 + 40 * inputs.length + 30 * outputs.length + destinations.length;
      sizes.push(size);
      return size;
    },
    async getTransactionId(transaction: Uint8Array) {
      return bytesToHex(sha256(transaction));
    },
    async encodeWitness(params: WitnessParams) {
      witnesses.push(params);
      return utf8(`W:${params.inputIndex}:${bytesToHex(params.privateKey)}`);
    },
    async encodeSignedTransaction(transaction: Uint8Array, txWitnesses: Uint8Array[]) {
      return cat(transaction, ...txWitnesses);
    },
  } as unknown as MintlayerBindings & { witnesses: WitnessParams[]; sizes: number[] };
}

type FakeIndexer = { spendableUtxos(address: string): Promise<MlUtxo[]>; feerate(): Promise<string>; tip(): Promise<{ blockHeight: number; blockId: string }> };

function fakeIndexer(utxos: MlUtxo[], rate: string): FakeIndexer {
  return {
    async spendableUtxos(address) {
      return utxos.filter((utxo) => utxo.output.destination === address);
    },
    async feerate() {
      return rate;
    },
    async tip() {
      return { blockHeight: 12345, blockId: 'aa'.repeat(32) };
    },
  };
}

function coinUtxo(sourceId: string, index: number, address: string, amount: string): MlUtxo {
  return {
    outpoint: { sourceType: 'Transaction', sourceId, index },
    output: { type: 'Transfer', destination: address, value: { type: 'Coin', amount: { atoms: amount } } },
  };
}

function tokenUtxo(sourceId: string, index: number, address: string, amount: string): MlUtxo {
  return {
    outpoint: { sourceType: 'Transaction', sourceId, index },
    output: { type: 'Transfer', destination: address, value: { type: 'TokenV1', tokenId: TOKEN_ID, amount: { atoms: amount } } },
  };
}

/** Parse the fake transfer encoding back into fields. */
function parseOutputs(transaction: Uint8Array): { text: string } {
  return { text: new TextDecoder().decode(transaction) };
}

async function main() {
  const seed = await mnemonicToSeed(VECTOR_WORDS);
  const account = await deriveMlAccount(VECTOR_WORDS, 'mainnet');
  assert.equal(await mlAddressAt(account.xpub, 0, 0, 'mainnet'), VECTOR_ADDRESS, 'parity vector address');

  const changeAddress = await mlAddressAt(account.xpub, 1, 0, 'mainnet');
  const toAddress = VECTOR_ADDRESS; // loopback: send back to our own receiving address
  const utxoA = coinUtxo('aa'.repeat(32), 0, VECTOR_ADDRESS, atoms(500n));
  const utxoB = coinUtxo('bb'.repeat(32), 1, VECTOR_ADDRESS, atoms(200n));
  const tokenAt = tokenUtxo('cc'.repeat(32), 0, VECTOR_ADDRESS, atoms(5n));

  // 1. Single input with change: plan fields, invariant, build decodes.
  {
    const bindings = fakeBindings();
    const builder = new MlTxBuilder(bindings, fakeIndexer([utxoA], '1000'), 'mainnet');
    const plan = await builder.plan({ fromAddresses: [VECTOR_ADDRESS], to: toAddress, amountAtoms: atoms(5n), tier: 'standard' });
    // size = 80 + 40*1 + 30*2 + 1 = 181 -> fee = ceil(181/1000)*1000 = 1000
    assert.equal(plan.inputAtoms, atoms(500n));
    assert.equal(plan.feeAtoms, '1000');
    assert.equal(plan.changeAtoms, (BigInt(atoms(500n)) - BigInt(atoms(5n)) - 1000n).toString());
    assert.equal(plan.sizeBytes, 181);
    assert.equal(plan.rateAtomsPerKb, '1000');
    assert.equal(plan.selection.length, 1);

    const unsigned = await builder.build({ ...plan, to: toAddress, changeAddress });
    const decoded = parseOutputs(unsigned.transaction).text;
    assert.ok(decoded.includes(`T:${atoms(5n)}:${toAddress}`), 'recipient output present');
    assert.ok(decoded.includes(`T:${plan.changeAtoms}:${changeAddress}`), 'change output present');
    // Implicit-fee invariant: inputs - outputs = fee exactly.
    assert.equal((BigInt(plan.inputAtoms) - BigInt(plan.sendAtoms) - BigInt(plan.changeAtoms)).toString(), plan.feeAtoms);
    assert.equal(unsigned.inputs.length, 1);
    assert.ok(unsigned.inputs[0].outputBytes.length > 0, 'spent output re-encoded for the sighash');
    assert.equal(unsigned.txId, bytesToHex(sha256(unsigned.transaction)));
  }

  // 2. Fee rounding: rate 1001 with the same size rounds per the F8 rule.
  assert.equal(mlFeeAtoms(181, '1001'), (Math.ceil(181 / 1000) * 1001).toString());
  assert.equal(mlFeeAtoms(1000, '0'), '1', 'max(rate, 1) floor with a dead feerate answer');
  assert.equal(mlFeeAtoms(999, '500'), '500', 'partial kB still bills a whole kB at the rate');

  // 3. Two inputs when one cannot cover send + fee.
  {
    const bindings = fakeBindings();
    const builder = new MlTxBuilder(bindings, fakeIndexer([utxoB, utxoA], '1000'), 'mainnet');
    const plan = await builder.plan({ fromAddresses: [VECTOR_ADDRESS], to: toAddress, amountAtoms: atoms(600n), tier: 'fast' });
    assert.equal(plan.selection.length, 2, 'largest first, then the next one');
    assert.equal(plan.inputAtoms, atoms(700n));
    // Size grows with the second input and destinations: 80 + 80 + 60 + 2 = 222.
    assert.equal(plan.sizeBytes, 222);
  }

  // 4. Insufficient funds is typed, with the spendable detail.
  {
    const bindings = fakeBindings();
    const builder = new MlTxBuilder(bindings, fakeIndexer([utxoA, utxoB], '1000'), 'mainnet');
    await assert.rejects(
      () => builder.plan({ fromAddresses: [VECTOR_ADDRESS], to: toAddress, amountAtoms: atoms(900n), tier: 'standard' }),
      (e: unknown) => e instanceof SendError && e.kind === 'insufficient-funds',
    );
  }

  // 5. Token transfer variant: token input covers the send, a coin input
  //    carries the fee, change stays coin.
  {
    const bindings = fakeBindings();
    const builder = new MlTxBuilder(bindings, fakeIndexer([utxoA, tokenAt], '1000'), 'mainnet');
    const plan = await builder.plan({
      fromAddresses: [VECTOR_ADDRESS],
      to: toAddress,
      amountAtoms: atoms(2n),
      tier: 'standard',
      tokenId: TOKEN_ID,
    });
    assert.equal(plan.selection.find((input) => input.tokenId === TOKEN_ID)?.atoms, atoms(5n), 'the whole indivisible token utxo is selected');
    assert.ok(plan.selection.some((input) => input.tokenId === null), 'a coin input pays the fee');
    const unsigned = await builder.build({ ...plan, to: toAddress, changeAddress });
    const decoded = parseOutputs(unsigned.transaction).text;
    assert.ok(decoded.includes(`K:${TOKEN_ID}:${atoms(2n)}:${toAddress}`), 'token transfer output present');
    assert.ok(decoded.includes(`K:${TOKEN_ID}:${atoms(3n)}:${changeAddress}`), 'token remainder returns to the change address');
    assert.ok(decoded.includes(`T:${plan.changeAtoms}:${changeAddress}`), 'coin change output present');
    // The token legs do not count toward the fee invariant; the coin legs do.
    const coinInputs = plan.selection.filter((input) => input.tokenId === null).reduce((acc, input) => acc + BigInt(input.atoms), 0n);
    assert.equal((coinInputs - BigInt(plan.feeAtoms) - BigInt(plan.changeAtoms)).toString(), '0');
  }

  // 6. Selection rejects when no coin pool exists for a token fee.
  await assert.rejects(
    () =>
      selectMlInputs({
        utxos: [tokenAt],
        sendAtoms: atoms(1n),
        tokenId: TOKEN_ID,
        rateAtomsPerKb: '1000',
        sizeOf: async () => 181,
      }),
    (e: unknown) => e instanceof SendError && e.kind === 'insufficient-funds',
  );

  // 7. Signer loopback over the bindings interface: one witness per input,
  //    correct child keys per input address, secrets only inside the closure.
  {
    const bindings = fakeBindings();
    const builder = new MlTxBuilder(bindings, fakeIndexer([utxoB, utxoA], '1000'), 'mainnet');
    const plan = await builder.plan({ fromAddresses: [VECTOR_ADDRESS], to: toAddress, amountAtoms: atoms(600n), tier: 'standard' });
    const unsigned = await builder.build({ ...plan, to: toAddress, changeAddress });

    const signer = new MlTxSigner(bindings, 'mainnet');
    const session: Pick<KeySession, 'withSeed'> = { withSeed: async (fn) => fn(seed) };
    const signedHex = await signer.sign(unsigned, session as KeySession, 12346);

    assert.equal(bindings.witnesses.length, unsigned.inputs.length, 'one encodeWitness per input');
    for (const [index, witness] of bindings.witnesses.entries()) {
      assert.equal(witness.sighashType, 'all');
      assert.equal(witness.inputIndex, index);
      assert.equal(witness.inclusionHeight, 12346);
      assert.equal(witness.inputUtxos?.length, unsigned.inputs.length, 'spent output per input rides the sighash');
    }
    // Address-to-path mapping: the parity vector address is receiving
    // index 0, so both witnesses carry that branch's child key.
    const { xpub } = mlXpubFromSeed(seed, 'mainnet');
    assert.equal(await mlAddressAt(xpub, 0, 0, 'mainnet'), VECTOR_ADDRESS, 'vector address is receiving index 0');
    const expectedKey = bytesToHex(mlPrivateKeyFromSeed(seed, 'mainnet', 0, 0));
    for (const witness of bindings.witnesses) {
      assert.equal(bytesToHex(witness.privateKey), expectedKey, 'witness key derives from the wallet seed');
    }

    // A foreign input address (the testnet tree of the same seed, never
    // derivable from this mainnet account) rejects before any witness work.
    const foreign = 'tmt1qyxqfq37rra32sq6zhayqcpjwh4trc07mcfardwt';
    const foreignTx = { ...unsigned, inputs: [{ ...unsigned.inputs[0], address: foreign }] };
    await assert.rejects(
      () => signer.sign(foreignTx, session as KeySession, 12346),
      (e: unknown) => e instanceof SendError && e.kind === 'rejected',
    );
    // Signed bytes: unsigned transaction followed by the witness blobs.
    assert.equal(signedHex.startsWith(bytesToHex(unsigned.transaction)), true);
    assert.equal(hex.decode(signedHex).length > unsigned.transaction.length, true);
  }

  console.log('mlTxBuilder.test: ok');
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
