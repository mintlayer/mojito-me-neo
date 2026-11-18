// Bindings seam parity gate: the TS mirror (modules/mojito-core/mintlayer/
// MintlayerBindings.ts) must match the pinned vendored UniFFI surface
// (vendor/mintlayer, release wallet-bindings-v0.1.0) exactly. The M4 review
// caught the mirror written against an imagined API (order ids without
// inputs, fill/conclude without nonce and block height, an HTLC params
// shape with a spendPubkey and a bare-number timelock the real facade
// never accepted), so this test pins both directions: the vendored
// signature lines carry a pinned checksum (vendored drift fails the gate)
// and the TS declarations are asserted line-for-line (mirror drift fails
// the gate). Reshaping either side requires re-reviewing the vendored
// source and re-pinning here in the same change.
//   tsx src/trade/bindingsParity.test.ts
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert/strict';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const VENDOR_SWIFT = 'vendor/mintlayer/MintlayerWalletBindings.swift';
const TS_MIRROR = 'modules/mojito-core/mintlayer/MintlayerBindings.ts';

/** One pinned seam function: the normalized vendored signature line and
 *  the TS declaration lines that mirror it. */
const PINNED: { name: string; swift: string; ts: string[] }[] = [
  {
    name: 'getOrderId',
    swift: 'public func getOrderId(inputs: [Data], network: Network)throws -> String {',
    ts: ['getOrderId(inputs: Uint8Array[], network: MlNetwork): Promise<string>;'],
  },
  {
    name: 'getTokenId',
    swift: 'public func getTokenId(inputs: [Data], currentBlockHeight: UInt64, network: Network)throws -> String {',
    ts: ['getTokenId(inputs: Uint8Array[], currentBlockHeight: number, network: MlNetwork): Promise<string>;'],
  },
  {
    name: 'encodeInputForFillOrder',
    swift: 'public func encodeInputForFillOrder(orderId: String, fillAmount: String, destination: String, nonce: UInt64, currentBlockHeight: UInt64, network: Network)throws -> Data {',
    ts: ['encodeInputForFillOrder(orderId: string, fillAmount: string, destination: string, nonce: number, currentBlockHeight: number, network: MlNetwork): Promise<Uint8Array>;'],
  },
  {
    name: 'encodeInputForConcludeOrder',
    swift: 'public func encodeInputForConcludeOrder(orderId: String, nonce: UInt64, currentBlockHeight: UInt64, network: Network)throws -> Data {',
    ts: ['encodeInputForConcludeOrder(orderId: string, nonce: number, currentBlockHeight: number, network: MlNetwork): Promise<Uint8Array>;'],
  },
  {
    name: 'encodeOutputHtlc',
    swift: 'public func encodeOutputHtlc(amount: String, tokenId: String?, secretHash: String, spendAddress: String, refundAddress: String, refundTimelock: Data, network: Network)throws -> Data {',
    ts: ['encodeOutputHtlc(params: HtlcParams): Promise<Uint8Array>;'],
  },
  {
    name: 'encodeLockForSeconds',
    swift: 'public func encodeLockForSeconds(totalSeconds: UInt64) -> Data {',
    ts: ['encodeLockForSeconds(totalSeconds: number): Promise<Uint8Array>;'],
  },
  {
    name: 'extractHtlcSecret',
    swift: 'public func extractHtlcSecret(signedTx: Data, strictByteSize: Bool, htlcOutpointSourceId: Data, htlcOutputIndex: UInt32)throws -> Data {',
    ts: ['extractHtlcSecret(signedTx: Uint8Array, strictByteSize: boolean, htlcOutpointSourceId: Uint8Array, htlcOutputIndex: number): Promise<Uint8Array>;'],
  },
  {
    name: 'decodeTransactionToJson',
    swift: 'public func decodeTransactionToJson(transaction: Data, network: Network)throws -> String {',
    ts: ['decodeTransactionToJson(transaction: Uint8Array, network: MlNetwork): Promise<string>;'],
  },
  {
    name: 'getTransactionId',
    swift: 'public func getTransactionId(transaction: Data, strictByteSize: Bool)throws -> String {',
    ts: ['getTransactionId(transaction: Uint8Array, strictByteSize: boolean): Promise<string>;'],
  },
  {
    name: 'encodeTransaction',
    swift: 'public func encodeTransaction(inputs: [Data], outputs: [Data], flags: UInt64)throws -> Data {',
    ts: ['encodeTransaction(inputs: Uint8Array[], outputs: Uint8Array[], flags: number): Promise<Uint8Array>;'],
  },
  {
    name: 'encodeOutpointSourceId',
    swift: 'public func encodeOutpointSourceId(id: Data, source: SourceId)throws -> Data {',
    ts: ["encodeOutpointSourceId(id32: Uint8Array, source: 'transaction' | 'block-reward'): Promise<Uint8Array>;"],
  },
  {
    name: 'encodeInputForUtxo',
    swift: 'public func encodeInputForUtxo(outpointSourceId: Data, outputIndex: UInt32)throws -> Data {',
    ts: ['encodeInputForUtxo(outpointSource: Uint8Array, index: number): Promise<Uint8Array>;'],
  },
];

/** The HTLC params record: the vendored facade takes a hex secret hash and
 *  an encodeLock* blob timelock and has no spendPubkey parameter. */
const HTLC_PARAMS_TS_FIELDS = [
  'amount: string;',
  'tokenId?: string;',
  'secretHash: string;',
  'spendAddress: string;',
  'refundAddress: string;',
  'refundTimelock: Uint8Array;',
];

/** Pinned sha256 over the joined normalized vendored signature lines, in
 *  the PINNED order. Recompute and update together with a vendored
 *  artifact upgrade only after re-reviewing every seam signature. */
const PINNED_VENDOR_CHECKSUM = 'e0474caed1b25ae53f7f5e6c8bca888b07e400ebb4ccbbcb89ae95f1847d8e52';

function normalize(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function main() {
  const swiftText = readFileSync(VENDOR_SWIFT, 'utf8');
  const tsText = readFileSync(TS_MIRROR, 'utf8');
  const swiftLines = swiftText.split('\n').map(normalize);

  // Vendored side: every pinned signature must exist exactly as pinned,
  // and the joined set must match the pinned checksum (any vendored
  // upgrade that touches the seam fails here).
  const checksumInput: string[] = [];
  for (const pin of PINNED) {
    const line = swiftLines.find((candidate) => candidate.startsWith(`public func ${pin.name}(`));
    assert.ok(line, `vendored signature for ${pin.name} not found in ${VENDOR_SWIFT}`);
    assert.equal(line, pin.swift, `vendored signature drift for ${pin.name}`);
    checksumInput.push(line);
  }
  const checksum = bytesToHex(sha256(new TextEncoder().encode(checksumInput.join('\n'))));
  assert.equal(
    checksum,
    PINNED_VENDOR_CHECKSUM,
    `vendored bindings checksum changed (got ${checksum}); re-review the seam against the new artifacts and re-pin`,
  );

  // Mirror side: the TS declarations must exist line-for-line, and the
  // imagined-API forms must be gone for good.
  const tsLines = tsText.split('\n').map((line) => line.trim());
  for (const pin of PINNED) {
    for (const expected of pin.ts) {
      assert.ok(
        tsLines.includes(expected),
        `TS mirror is missing the pinned declaration for ${pin.name}: ${expected}`,
      );
    }
  }
  for (const field of HTLC_PARAMS_TS_FIELDS) {
    assert.ok(tsLines.includes(field), `HtlcParams is missing the pinned field ${field}`);
  }
  assert.ok(!/spendPubkey/.test(tsText), 'HtlcParams must not carry a spendPubkey field (not in the vendored encodeOutputHtlc)');
  assert.ok(!/getOrderId\(transaction/.test(tsText), 'getOrderId must take the create tx inputs, not a transaction plus output index');
  assert.ok(!/refundTimelock: number/.test(tsText), 'refundTimelock must ride the encodeLockForSeconds blob, not a bare number');

  console.log('bindingsParity: ok');
}

main();
