// Generic derivation-path support for the discovery custom-path scan. A
// custom path is a full BIP32 account path m/purpose'/coin'/account' with
// all three levels hardened; the chain is chosen from the levels:
//   purpose 84 -> BTC P2WPKH account (coin 0 mainnet, coin 1 testnet)
//   purpose 44 -> Mintlayer account (coin 19788 mainnet, coin 1 testnet)
// Anything else (other purposes, unknown coin types, soft address levels
// baked into the path) is rejected: the wallet only spends from these two
// account types in v1.
import { deriveMlAccountAtPath, type MlAccount, type MlDerivationNetwork } from './mlAccounts';
import { deriveBtcAccountAtPath, type BtcAccount, type BtcNetwork } from './BtcKeyring';

export class CustomPathError extends Error {
  constructor(readonly kind: 'shape' | 'purpose' | 'coin') {
    super(`unsupported derivation path: ${kind}`);
  }
}

export type CustomScan = {
  chain: 'ml' | 'btc';
  network: MlDerivationNetwork | BtcNetwork;
  account: MlAccount | BtcAccount;
};

const LEVEL_SHAPE = /^\d+'$/;

/** Parse m/44'/19788'/0' style account paths into plain hardened indices. */
function parseAccountPath(path: string): number[] {
  const levels = path.trim().split('/').slice(1);
  if (levels.length !== 3 || !levels.every((l) => LEVEL_SHAPE.test(l))) {
    throw new CustomPathError('shape');
  }
  return levels.map((l) => parseInt(l, 10));
}

/**
 * Derive the account a custom path points at. `words` must already be
 * validated (mnemonicToSeed re-validates). Receiving and change addresses
 * hang below the returned account as usual (branch 0/1, soft indices).
 */
export async function deriveCustomScan(words: string[], path: string): Promise<CustomScan> {
  const levels = parseAccountPath(path);
  const trimmed = path.trim();
  const [purpose, coin] = levels;
  if (purpose === 84) {
    const network: BtcNetwork = coin === 0 ? 'mainnet' : 'testnet';
    if (coin !== 0 && coin !== 1) throw new CustomPathError('coin');
    return { chain: 'btc', network, account: await deriveBtcAccountAtPath(words, trimmed, network) };
  }
  if (purpose === 44) {
    const network: MlDerivationNetwork = coin === 19788 ? 'mainnet' : 'testnet';
    if (coin !== 19788 && coin !== 1) throw new CustomPathError('coin');
    return { chain: 'ml', network, account: await deriveMlAccountAtPath(words, levels, network) };
  }
  throw new CustomPathError('purpose');
}
