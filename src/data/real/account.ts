// Shared real-mode account context (M3): one AddressManager, one set of
// chain clients and one balance/activity bundle per provider set, consumed
// by both the M2 wallet data layer and the M3 send service. Sharing is the
// correctness requirement, not a convenience: the send service advances the
// receiving index after an outbound transaction (fresh-address policy), and
// the receive/home surfaces must observe that rotation in the same process.
//
// IndexerClient and BtcChainService accept injected fetch/delay only for
// the Node gate; production construction here uses the platform fetch.
import { IndexerClient, IndexerError } from '../ml/IndexerClient';
import { BtcChainService } from '../btc/BtcChainService';
import { BalanceService } from '../ml/BalanceService';
import { NftService } from '../ml/NftService';
import { ActivityService } from '../activity/ActivityService';
import { createAddressManager, type AddressManager } from '../addresses/AddressManager';
import { mlAddressAt } from '../../keys/mlAccounts';
import { btcAddressAt } from '../../keys/BtcKeyring';
import { loadAddressIndex, saveAddressIndex } from '../../storage/addressStore';
import type { NetworkFlag } from '../../config/endpoints';

export type RealAccountConfig = {
  network: NetworkFlag;
  indexerBase: string | null;
  btcBase: string | null;
  /** Opens the vault once to derive the public account xpubs (M1 keyrings).
   *  Public material only: xpub blobs and addresses, never the seed. */
  deriveXpubs: () => Promise<{ mlXpub: Uint8Array; btcXpub: string }>;
};

export type RealAccountContext = {
  cfg: RealAccountConfig;
  /** Single shared construction (manager, clients, services). */
  ensureAccount: () => Promise<AccountServices>;
  /** Type guard for the unconfigured indexer (testnet pending A2): throws
   *  typed when absent, hands back the client otherwise, so callers never
   *  re-check null behind the guard. */
  requireIndexer: () => IndexerClient;
  indexer: IndexerClient | null;
  btc: BtcChainService | null;
};

export type AccountServices = {
  manager: AddressManager;
  balance: BalanceService | null;
  nfts: NftService | null;
  activity: ActivityService | null;
  btc: BtcChainService | null;
};

export function createRealAccountContext(cfg: RealAccountConfig): RealAccountContext {
  let accountPromise: Promise<AccountServices> | null = null;
  const indexer = cfg.indexerBase ? new IndexerClient(cfg.indexerBase) : null;
  const btc = cfg.btcBase ? new BtcChainService(cfg.btcBase) : null;

  function requireIndexer(): IndexerClient {
    if (indexer === null) throw new IndexerError('transport', 'indexer', undefined);
    return indexer;
  }

  async function ensureAccount() {
    if (accountPromise === null) {
      accountPromise = (async () => {
        const { mlXpub, btcXpub } = await cfg.deriveXpubs();
        const manager = createAddressManager({
          network: cfg.network,
          load: loadAddressIndex,
          save: saveAddressIndex,
          derive: {
            ml: (branch, index) => mlAddressAt(mlXpub, branch, index, cfg.network),
            btc: (branch, index) => btcAddressAt({ xpub: btcXpub, network: cfg.network }, branch, index),
          },
          probe: {
            // Sequential probe per address; the client maps the documented
            // fresh-address 404 to unused, so the scan exits at the gap.
            ml: indexer
              ? async (address) => {
                  try {
                    await indexer.addressInfo(address);
                    return true;
                  } catch (e) {
                    if (e instanceof IndexerError && e.status === 404) return false;
                    throw e;
                  }
                }
              : undefined,
            btc: btc
              ? async (address) => {
                  const stats = await btc.addressStats(address);
                  return stats.chain.txCount > 0 || stats.mempool.txCount > 0;
                }
              : undefined,
          },
        });
        const balance = indexer ? new BalanceService(indexer, () => manager.allAddresses('ml')) : null;
        const nfts = indexer ? new NftService(indexer) : null;
        const activity = indexer
          ? new ActivityService({
              ml: {
                client: indexer,
                addresses: () => manager.allAddresses('ml'),
                tokenMeta: (tokenId) => balance!.tokenMeta(tokenId),
              },
              btc: btc ? { client: btc, addresses: () => manager.allAddresses('btc') } : undefined,
            })
          : null;
        return { manager, balance, nfts, activity, btc };
      })().catch((e: unknown) => {
        // Reset so a transient failure (locked session) can succeed later.
        accountPromise = null;
        throw e;
      });
    }
    return accountPromise;
  }

  return { cfg, ensureAccount, requireIndexer, indexer, btc };
}

export type { AddressManager };
