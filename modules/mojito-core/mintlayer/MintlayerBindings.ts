// TS mirror of the UniFFI surface we consume. Names follow the Kotlin/Swift
// spellings from docs/build/sdks/mobile-bindings.md. Amounts are decimal atom
// strings. All fallible calls reject with BindingsError.
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

  // signing and witnesses
  encodeWitness(params: WitnessParams): Promise<Uint8Array>;
  encodeWitnessNoSignature(): Promise<Uint8Array>;
  encodeWitnessHtlcSpend(params: WitnessParams): Promise<Uint8Array>;
  encodeWitnessHtlcRefundSingleSig(params: WitnessParams): Promise<Uint8Array>;
  encodeSignedTransaction(transaction: Uint8Array, witnesses: Uint8Array[]): Promise<Uint8Array>;
  extractHtlcSecret(signedTx: Uint8Array, strictByteSize: boolean, htlcOutpointSourceId: Uint8Array, htlcOutputIndex: number): Promise<Uint8Array>;

  // orders
  encodeCreateOrderOutput(params: OrderParams): Promise<Uint8Array>;
  encodeInputForFillOrder(orderId: Uint8Array, destination: Uint8Array, amount: string): Promise<Uint8Array>;
  encodeInputForConcludeOrder(orderId: Uint8Array, destination: Uint8Array): Promise<Uint8Array>;
  getOrderId(transaction: Uint8Array, outputIndex: number): Promise<string>;
  getTokenId(transaction: Uint8Array, outputIndex: number): Promise<string>;

  // static fee schedule
  fungibleTokenIssuanceFee(): Promise<string>;
  nftIssuanceFee(): Promise<string>;
}

export type HtlcParams = {
  atoms: string; tokenId?: string; secretHash: Uint8Array;
  spendAddress: string; spendPubkey: Uint8Array; refundAddress: string; refundTimelock: number;
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
