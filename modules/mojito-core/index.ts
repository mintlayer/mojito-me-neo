// Expo module registration and the MojitoCore type surface. The native module
// ships the crypto facade for real (secure random, AES-256-GCM seal and open
// over Keychain or Keystore resident keys). The MintlayerBindings call-throughs
// are stubbed on the native side until M1 ships the AAR and xcframework; every
// stub rejects with BindingsError { kind: 'unknown', detail: 'bindings arrive
// in M1' } so the interface is exercised but nothing pretends to derive keys.
import { requireNativeModule } from 'expo-modules-core';

import {
  HtlcParams,
  MintlayerBindings,
  MlNetwork,
  OrderParams,
  WitnessParams,
  bindingsError,
} from './mintlayer/MintlayerBindings';

export type {
  BindingsError,
  HtlcParams,
  MintlayerBindings,
  MlNetwork,
  OrderParams,
  WitnessParams,
} from './mintlayer/MintlayerBindings';

/** Hex-string fields of an encrypted blob, versioned for future migrations. */
export type SealedBlob = { v: 1; iv: string; ct: string; tag: string };

type NativeCore = Record<string, (...args: unknown[]) => Promise<unknown>>;

let nativeModule: NativeCore | null | undefined;

async function loadNative(): Promise<NativeCore | null> {
  if (nativeModule === undefined) {
    try {
      nativeModule = requireNativeModule('MojitoCore') as NativeCore;
    } catch {
      nativeModule = null;
    }
  }
  return nativeModule;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw bindingsError('odd-length hex string', 'decoding');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw bindingsError('expected byte payload', 'decoding');
}

/** Byte arrays and nested byte fields survive JSON as hex; M1 replaces this
 *  mapping with the real typed bridge calls. */
function replacer(_key: string, value: unknown): unknown {
  return value instanceof Uint8Array ? bytesToHex(value) : value;
}

/** Reject the same way whether the native stub refused or no module exists. */
async function stub(name: string, args: unknown[]): Promise<never> {
  const native = await loadNative();
  if (native) {
    // The call goes over the bridge so the native stub stays in the loop; its
    // rejection is normalized below into the structured BindingsError. Struct
    // params are flattened to JSON strings so the native stub signatures stay
    // primitive until the real bindings arrive.
    const flat = args.map((a) =>
      a instanceof Uint8Array || a === null || typeof a !== 'object' ? a : JSON.stringify(a, replacer),
    );
    try {
      await native[name](...flat);
    } catch {
      // fall through to the structured error
    }
  }
  throw bindingsError('bindings arrive in M1');
}

/** True when the native MojitoCore module is present (dev builds, not Expo Go). */
export async function hasNativeCore(): Promise<boolean> {
  return (await loadNative()) !== null;
}

export interface MojitoCore extends MintlayerBindings {
  secureRandom(length: number): Promise<Uint8Array>;
  // storage: key is generated and stored inside Keychain/Keystore, never returned
  seal(keyId: string, plaintext: Uint8Array): Promise<SealedBlob>;
  open(keyId: string, blob: SealedBlob): Promise<Uint8Array>;
  wipe(keyId: string): Promise<void>;
  keyExists(keyId: string): Promise<boolean>;
}

/** Bridge-side guard: a negative count crashes iOS unrecoverably; keep the
 *  requests bounded so a JS-side bug fails as a normal rejection. */
const MAX_RANDOM_BYTES = 64 * 1024;

function requireRandomLength(length: number): void {
  if (!Number.isInteger(length) || length < 0 || length > MAX_RANDOM_BYTES) {
    throw bindingsError(`secureRandom length must be an integer in 0..${MAX_RANDOM_BYTES}`);
  }
}

function requireIv(iv: string): void {
  if (iv.length !== 24 || !/^[0-9a-f]+$/i.test(iv)) throw bindingsError('iv must be 12 hex bytes');
}

// The interface and the concrete facade share the MojitoCore name on purpose:
// the import gives callers the full typed surface and the callable singleton.
// eslint-disable-next-line @typescript-eslint/no-redeclare
export const MojitoCore: MojitoCore = {
  async secureRandom(length: number): Promise<Uint8Array> {
    requireRandomLength(length);
    const native = await loadNative();
    if (!native) throw bindingsError('native module unavailable');
    return toBytes(await native['secureRandom'](length));
  },

  async seal(keyId: string, plaintext: Uint8Array): Promise<SealedBlob> {
    const native = await loadNative();
    if (!native) throw bindingsError('native module unavailable');
    const blob = (await native['seal'](keyId, plaintext)) as { iv: string; ct: string; tag: string };
    return { v: 1, iv: blob.iv, ct: blob.ct, tag: blob.tag };
  },

  async open(keyId: string, blob: SealedBlob): Promise<Uint8Array> {
    requireIv(blob.iv);
    const native = await loadNative();
    if (!native) throw bindingsError('native module unavailable');
    return toBytes(await native['open'](keyId, blob.iv, blob.ct, blob.tag));
  },

  async wipe(keyId: string): Promise<void> {
    const native = await loadNative();
    if (!native) throw bindingsError('native module unavailable');
    await native['wipe'](keyId);
  },

  async keyExists(keyId: string): Promise<boolean> {
    const native = await loadNative();
    if (!native) throw bindingsError('native module unavailable');
    return (await native['keyExists'](keyId)) === true;
  },

  // keys and addresses
  makeDefaultAccountPrivkey(mnemonic: string, network: MlNetwork, passphrase: string | null) {
    return stub('makeDefaultAccountPrivkey', [mnemonic, network, passphrase]);
  },
  extendedPublicKeyFromExtendedPrivateKey(accountPrivkey: Uint8Array) {
    return stub('extendedPublicKeyFromExtendedPrivateKey', [accountPrivkey]);
  },
  makeReceivingAddressPublicKey(accountPublicKey: Uint8Array, keyIndex: number) {
    return stub('makeReceivingAddressPublicKey', [accountPublicKey, keyIndex]);
  },
  makeChangeAddressPublicKey(accountPublicKey: Uint8Array, keyIndex: number) {
    return stub('makeChangeAddressPublicKey', [accountPublicKey, keyIndex]);
  },
  publicKeyFromPrivateKey(privateKey: Uint8Array) {
    return stub('publicKeyFromPrivateKey', [privateKey]);
  },
  pubkeyToPubkeyhashAddress(publicKey: Uint8Array, network: MlNetwork) {
    return stub('pubkeyToPubkeyhashAddress', [publicKey, network]);
  },
  encodeDestination(address: string, network: MlNetwork) {
    return stub('encodeDestination', [address, network]);
  },

  // transaction assembly
  encodeOutpointSourceId(id32: Uint8Array, source: 'transaction' | 'block-reward') {
    return stub('encodeOutpointSourceId', [id32, source]);
  },
  encodeInputForUtxo(outpointSource: Uint8Array, index: number) {
    return stub('encodeInputForUtxo', [outpointSource, index]);
  },
  encodeOutputTransfer(atoms: string, address: string, network: MlNetwork) {
    return stub('encodeOutputTransfer', [atoms, address, network]);
  },
  encodeOutputTokenTransfer(tokenId: string, atoms: string, address: string, network: MlNetwork) {
    return stub('encodeOutputTokenTransfer', [tokenId, atoms, address, network]);
  },
  encodeOutputHtlc(params: HtlcParams) {
    return stub('encodeOutputHtlc', [params]);
  },
  encodeTransaction(inputs: Uint8Array[], outputs: Uint8Array[], flags: number) {
    return stub('encodeTransaction', [inputs, outputs, flags]);
  },
  estimateTransactionSize(inputs: Uint8Array[], inputDestinations: string[], outputs: Uint8Array[], network: MlNetwork) {
    return stub('estimateTransactionSize', [inputs, inputDestinations, outputs, network]);
  },
  getTransactionId(transaction: Uint8Array, strictByteSize: boolean) {
    return stub('getTransactionId', [transaction, strictByteSize]);
  },
  decodeTransactionToJson(transaction: Uint8Array, network: MlNetwork) {
    return stub('decodeTransactionToJson', [transaction, network]);
  },

  // signing and witnesses
  encodeWitness(params: WitnessParams) {
    return stub('encodeWitness', [params]);
  },
  encodeWitnessNoSignature() {
    return stub('encodeWitnessNoSignature', []);
  },
  encodeWitnessHtlcSpend(params: WitnessParams) {
    return stub('encodeWitnessHtlcSpend', [params]);
  },
  encodeWitnessHtlcRefundSingleSig(params: WitnessParams) {
    return stub('encodeWitnessHtlcRefundSingleSig', [params]);
  },
  encodeSignedTransaction(transaction: Uint8Array, witnesses: Uint8Array[]) {
    return stub('encodeSignedTransaction', [transaction, witnesses]);
  },
  extractHtlcSecret(signedTx: Uint8Array, strictByteSize: boolean, htlcOutpointSourceId: Uint8Array, htlcOutputIndex: number) {
    return stub('extractHtlcSecret', [signedTx, strictByteSize, htlcOutpointSourceId, htlcOutputIndex]);
  },

  // orders
  encodeCreateOrderOutput(params: OrderParams) {
    return stub('encodeCreateOrderOutput', [params]);
  },
  encodeInputForFillOrder(orderId: Uint8Array, destination: Uint8Array, amount: string) {
    return stub('encodeInputForFillOrder', [orderId, destination, amount]);
  },
  encodeInputForConcludeOrder(orderId: Uint8Array, destination: Uint8Array) {
    return stub('encodeInputForConcludeOrder', [orderId, destination]);
  },
  getOrderId(transaction: Uint8Array, outputIndex: number) {
    return stub('getOrderId', [transaction, outputIndex]);
  },
  getTokenId(transaction: Uint8Array, outputIndex: number) {
    return stub('getTokenId', [transaction, outputIndex]);
  },

  // static fee schedule
  fungibleTokenIssuanceFee() {
    return stub('fungibleTokenIssuanceFee', []);
  },
  nftIssuanceFee() {
    return stub('nftIssuanceFee', []);
  },
};
