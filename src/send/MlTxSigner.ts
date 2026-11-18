// Mintlayer transaction signer (spec M3 deliverable 5): one
// bindings.encodeWitness per input (F8 signing pattern) and
// bindings.encodeSignedTransaction assembly, over the MintlayerBindings
// interface. The signing itself is the bindings' job and is never
// reimplemented in JavaScript: without the native call-through this module
// rejects, which is the recorded device-pending state (modules/mojito-core
// header), not a fallback.
//
// Secrets stay in the KeySession closure: the seed and every child private
// key exist only inside withSeed; witness bytes and the signed transaction
// (public payload) are all that escape.
import { bytesToHex } from '@noble/hashes/utils.js';

import type { MintlayerBindings, WitnessParams } from '../../modules/mojito-core';
import {
  mlAddressAt,
  mlPrivateKeyFromSeed,
  mlXpubFromSeed,
  type MlBranch,
  type MlDerivationNetwork,
} from '../keys/mlAccounts';
import type { KeySession } from '../keys/session';
import { SendError } from './errors';
import type { UnsignedMlTx } from './MlTxBuilder';

/** Watch bound for mapping input addresses back to derivation paths; aligned
 *  with the AddressManager scan ceiling so no reachable wallet index is
 *  outside this walk. */
const ORIGIN_WALK_LIMIT = 512;

type MlSigningNetwork = Extract<MlDerivationNetwork, 'mainnet' | 'testnet'>;

export class MlTxSigner {
  constructor(
    private readonly bindings: MintlayerBindings,
    private readonly network: MlSigningNetwork,
  ) {}

  /**
   * Sign every input of the unsigned transaction and return the signed
   * transaction hex (inclusion height = tip + 1 per F8, supplied by the
   * caller). Addresses that do not derive from this wallet's account reject
   * before any witness work happens.
   */
  async sign(unsigned: UnsignedMlTx, session: KeySession, inclusionHeight: number): Promise<string> {
    if (unsigned.inputs.length === 0) throw new SendError('rejected', 'nothing to sign');
    return session.withSeed(async (seed) => {
      const origins = await this.resolveOrigins(unsigned, seed);
      const witnesses: Uint8Array[] = [];
      for (let inputIndex = 0; inputIndex < unsigned.inputs.length; inputIndex++) {
        const input = unsigned.inputs[inputIndex];
        const origin = origins.get(input.address);
        if (origin === undefined) throw new SendError('rejected', `input ${inputIndex} is not from this wallet`);
        const privateKey = mlPrivateKeyFromSeed(seed, this.network, origin.branch, origin.index);
        const params: WitnessParams = {
          sighashType: 'all',
          privateKey,
          address: input.address,
          transaction: unsigned.transaction,
          // F8: the sighash needs the spent output per input; one re-encoded
          // output per transaction input, in input order.
          inputUtxos: unsigned.inputs.map((entry) => entry.outputBytes),
          inputIndex,
          inclusionHeight,
          network: this.network,
        };
        witnesses.push(await this.bindings.encodeWitness(params));
      }
      const signed = await this.bindings.encodeSignedTransaction(unsigned.transaction, witnesses);
      return bytesToHex(signed);
    });
  }

  /** Map each input address to its (branch, index) by walking the account's
   *  public derivation; no network, no secrets outside the closure. */
  private async resolveOrigins(unsigned: UnsignedMlTx, seed: Uint8Array): Promise<Map<string, { branch: MlBranch; index: number }>> {
    const { xpub } = mlXpubFromSeed(seed, this.network);
    const wanted = new Set(unsigned.inputs.map((input) => input.address));
    const origins = new Map<string, { branch: MlBranch; index: number }>();
    for (const branch of [0, 1] as MlBranch[]) {
      for (let index = 0; index < ORIGIN_WALK_LIMIT && origins.size < wanted.size; index++) {
        const address = await mlAddressAt(xpub, branch, index, this.network);
        if (wanted.has(address)) origins.set(address, { branch, index });
      }
    }
    return origins;
  }
}
