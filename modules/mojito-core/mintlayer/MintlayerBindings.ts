// TS mirror of the vendored UniFFI surface (vendor/mintlayer, release
// wallet-bindings-v0.1.0). The signatures below are pinned byte-for-byte
// against the vendored Swift/Kotlin facade by src/trade/bindingsParity.test.ts:
// reshaping this file without the vendored source (or vice versa) fails the
// gate. Swift UInt64/UInt32 arguments ride JS numbers (block heights, nonces
// and indexes fit safely); amounts stay decimal atom strings and ids stay
// bech32 strings, exactly the vendored String forms. All fallible calls
// reject with BindingsError.
export type MlNetwork = 'mainnet' | 'testnet' | 'regtest' | 'signet';

export type BindingsError = {
  kind:
    | 'invalid-mnemonic' | 'decoding' | 'signing' | 'sighash'
    | 'address-parse' | 'amount' | 'orders-v1-not-activated' | 'unknown';
  detail: string;
};

export interface MintlayerBindings {
  // keys and addresses
  makeDefaultAccountPrivkey(mnemonic: string, network: MlNetwork, passphrase: string | null): Promise<Uint8Array>;
  extendedPublicKeyFromExtendedPrivateKey(accountPrivkey: Uint8Array): Promise<Uint8Array>;
  makeReceivingAddressPublicKey(accountPublicKey: Uint8Array, keyIndex: number): Promise<Uint8Array>;
  makeChangeAddressPublicKey(accountPublicKey: Uint8Array, keyIndex: number): Promise<Uint8Array>;
  publicKeyFromPrivateKey(privateKey: Uint8Array): Promise<Uint8Array>;
  pubkeyToPubkeyhashAddress(publicKey: Uint8Array, network: MlNetwork): Promise<string>;
  encodeDestination(address: string, network: MlNetwork): Promise<Uint8Array>;

  // transaction assembly
  encodeOutpointSourceId(id32: Uint8Array, source: 'transaction' | 'block-reward'): Promise<Uint8Array>;
  encodeInputForUtxo(outpointSource: Uint8Array, index: number): Promise<Uint8Array>;
  encodeOutputTransfer(atoms: string, address: string, network: MlNetwork): Promise<Uint8Array>;
  encodeOutputTokenTransfer(tokenId: string, atoms: string, address: string, network: MlNetwork): Promise<Uint8Array>;
  encodeOutputHtlc(params: HtlcParams): Promise<Uint8Array>;
  encodeTransaction(inputs: Uint8Array[], outputs: Uint8Array[], flags: number): Promise<Uint8Array>;
  estimateTransactionSize(inputs: Uint8Array[], inputDestinations: string[], outputs: Uint8Array[], network: MlNetwork): Promise<number>;
  getTransactionId(transaction: Uint8Array, strictByteSize: boolean): Promise<string>;
  decodeTransactionToJson(transaction: Uint8Array, network: MlNetwork): Promise<string>;

  // timelock encoders: the HTLC refundTimelock argument is the blob one of
  // these produces (the vendored facade exposes no bare-number form)
  encodeLockForSeconds(totalSeconds: number): Promise<Uint8Array>;

  // signing and witnesses
  encodeWitness(params: WitnessParams): Promise<Uint8Array>;
  encodeWitnessNoSignature(): Promise<Uint8Array>;
  encodeWitnessHtlcSpend(params: WitnessParams): Promise<Uint8Array>;
  encodeWitnessHtlcRefundSingleSig(params: WitnessParams): Promise<Uint8Array>;
  encodeSignedTransaction(transaction: Uint8Array, witnesses: Uint8Array[]): Promise<Uint8Array>;
  extractHtlcSecret(signedTx: Uint8Array, strictByteSize: boolean, htlcOutpointSourceId: Uint8Array, htlcOutputIndex: number): Promise<Uint8Array>;

  // orders
  encodeCreateOrderOutput(params: OrderParams): Promise<Uint8Array>;
  encodeInputForFillOrder(orderId: string, fillAmount: string, destination: string, nonce: number, currentBlockHeight: number, network: MlNetwork): Promise<Uint8Array>;
  encodeInputForConcludeOrder(orderId: string, nonce: number, currentBlockHeight: number, network: MlNetwork): Promise<Uint8Array>;
  /** The bech32 order id derived from the create transaction inputs. */
  getOrderId(inputs: Uint8Array[], network: MlNetwork): Promise<string>;
  /** The bech32 token id derived from the issuing transaction inputs; the
   *  id scheme depends on the upgrade active at currentBlockHeight. */
  getTokenId(inputs: Uint8Array[], currentBlockHeight: number, network: MlNetwork): Promise<string>;

  // static fee schedule
  fungibleTokenIssuanceFee(): Promise<string>;
  nftIssuanceFee(): Promise<string>;
}

export type HtlcParams = {
  /** Decimal atom amount (the vendored amount string). */
  amount: string;
  tokenId?: string;
  /** Hex-encoded SHA-256 secret hash (the vendored hex string form). */
  secretHash: string;
  spendAddress: string;
  refundAddress: string;
  /** Blob from encodeLockForSeconds (the vendored Data form). */
  refundTimelock: Uint8Array;
};

export type WitnessParams = {
  sighashType: 'all' | 'none' | 'single' | 'anyonecanpay';
  privateKey: Uint8Array; address: string; transaction: Uint8Array;
  inputUtxos: (Uint8Array | null)[]; inputIndex: number;
  additionalInfo?: { tokenId: string }; inclusionHeight: number; network: MlNetwork;
  /** F10 reveal field consumed by encodeWitnessHtlcSpend only (M4 atomic
   *  swap claim): the preimage that satisfies the HTLC hash. */
  secret?: Uint8Array;
};

export type OrderParams = {
  give: { tokenId: string | 'coin'; atoms: string };
  ask: { tokenId: string | 'coin'; atoms: string };
  concludeDestination: string; network: MlNetwork;
};

export function bindingsError(detail: string, kind: BindingsError['kind'] = 'unknown'): BindingsError {
  return { kind, detail };
}
