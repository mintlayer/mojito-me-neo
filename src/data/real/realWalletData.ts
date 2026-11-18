// Real-mode WalletData (spec M2 deliverable 8): balances, assets, activity,
// NFTs and addresses come from the M2 services over the public indexer and
// the configured BTC base; seams that belong to later milestones (market
// book M4, send fees M3, bridge M4, card M5) stay fixture-backed so no
// screen silently loses its data in real mode. Prices stay the mock
// provider per R1 in v1, so every USD figure here is indicative mock data.
//
// Balances are aggregated on BigInt atom strings in the services; Number()
// conversions happen only here, at the display boundary the existing
// AssetRow contract defines (no float money math reaches state or storage).
// Address scanning is sequential per the spec security note, and the home
// bundle is memoized for a few seconds so the portfolio and asset calls
// share one scan.
import type { ChainName } from '../../theme';
import { t } from '../../i18n';
import { ML_DECIMALS, atomsToDecimal, formatAmount, formatUsd } from '../../money';
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
import type { AssetRow, NftRow, PriceProvider, PriceSnapshot, WalletData } from '../providers/types';
import {
  CHAIN_GLYPH, CONTACTS, DAPPS, FEES, HTLC_STEPS, MARKET, RANGES, SWAP_STATS,
  TIMEFRAMES, WAITLIST, ASKS, BIDS, BRIDGE_CHAINS, BRIDGE_QUOTE, BRIDGE_ROUTE,
} from '../../data';
import { truncateMiddle } from '../../ui/format';
import { createFixtureWalletData } from '../mock/fixtures';
import { createFixturePriceProvider } from '../mock/priceFixtures';

/** How long one home bundle (portfolio, assets, nfts) is shared between calls. */
const HOME_CACHE_MS = 5_000;

export type RealWalletDataConfig = {
  network: NetworkFlag;
  indexerBase: string | null;
  btcBase: string | null;
  /** Opens the vault once to derive the public account xpubs (M1 keyrings).
   *  Public material only: xpub blobs and addresses, never the seed. */
  deriveXpubs: () => Promise<{ mlXpub: Uint8Array; btcXpub: string }>;
};

type AccountContext = {
  manager: AddressManager;
  balance: BalanceService | null;
  nfts: NftService | null;
  activity: ActivityService | null;
  btc: BtcChainService | null;
};

type AssetBuild = { row: AssetRow; decimal: string };

type HomeBundle = {
  portfolio: { total: string; change: number; delta: string; spark: number[] };
  assets: AssetRow[];
  /** Exact decimal strings per symbol, for the picker subtitle contract. */
  balances: Record<string, string>;
  nfts: NftRow[];
  loadedAt: number;
};

export function createRealWalletData(cfg: RealWalletDataConfig): WalletData {
  const fixtureData = createFixtureWalletData();
  const price = createFixturePriceProvider();

  let accountPromise: Promise<AccountContext> | null = null;
  let homeCache: HomeBundle | null = null;

  /** The home surfaces need the indexer; without a base (testnet pending
   *  action item A2) they fail typed-offline before any vault access. */
  function requireIndexerBase(): void {
    if (!cfg.indexerBase) throw new IndexerError('transport', 'indexer', undefined);
  }

  async function ensureAccount(): Promise<AccountContext> {
    if (accountPromise === null) {
      accountPromise = (async (): Promise<AccountContext> => {
        const { mlXpub, btcXpub } = await cfg.deriveXpubs();
        const indexer = cfg.indexerBase ? new IndexerClient(cfg.indexerBase) : null;
        const btc = cfg.btcBase ? new BtcChainService(cfg.btcBase) : null;
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
      })().catch((e) => {
        // Reset so a transient failure (locked session) can succeed later.
        accountPromise = null;
        throw e;
      });
    }
    return accountPromise;
  }

  /** One shared scan for portfolio, assets and NFTs, memoized briefly. A
   *  force call (pull-to-refresh) bypasses the cache window. */
  async function loadHome(opts?: { force?: boolean }): Promise<HomeBundle> {
    requireIndexerBase();
    if (!opts?.force && homeCache !== null && Date.now() - homeCache.loadedAt < HOME_CACHE_MS) return homeCache;
    const acct = await ensureAccount();
    if (!acct.balance || !acct.nfts) {
      // No indexer base (testnet pending A2): the home surfaces are offline.
      throw new IndexerError('transport', 'indexer', undefined);
    }
    const portfolio = await acct.balance.portfolio();
    const tokenIds = portfolio.tokens.map((entry) => entry.tokenId);
    const nftIds = await acct.nfts.identify(tokenIds);

    // Prices: mock provider per R1; snapshots exist for ML and BTC, unknown
    // token ids answer 0, which keeps the USD column an honest placeholder.
    const snapshots = new Map<string, PriceSnapshot>(
      (await price.getSnapshots(['ML', 'BTC', ...tokenIds])).map((s) => [s.tokenId, s]),
    );

    const builds: AssetBuild[] = [];
    const usedSymbols = new Set<string>();
    const pushAsset = (row: AssetRow, decimal: string) => {
      if (usedSymbols.has(row.sym)) row.sym = `${row.sym} 2`;
      usedSymbols.add(row.sym);
      builds.push({ row, decimal });
    };

    const mlDecimal = atomsToDecimal(portfolio.coinAtoms, ML_DECIMALS);
    pushAsset(assetRow('ML', 'Mintlayer', 'Mintlayer', mlDecimal, snapshots.get('ML') ?? null, await sparkFor(price, 'ML')), mlDecimal);

    let btcDecimal = '0';
    // Unconfigured btc-api base (F13): the BTC amount is unknown, not zero,
    // so the row renders an explicit unavailable state and the total stays
    // honest about what it excludes. A configured backend that fails keeps
    // the zero row so the ML surfaces keep rendering (transport failures
    // still surface through the offline banner, not a crash).
    const btcUnavailable = !acct.btc;
    if (acct.btc) {
      try {
        // Sum confirmed and unconfirmed sats over every derived address
        // (receiving and change), mirroring the ML BalanceService: the
        // current receiving address is the first unused one, so funds on
        // earlier addresses would otherwise read as zero.
        const addresses = await acct.manager.allAddresses('btc');
        let sat = 0n;
        for (const address of addresses) {
          const btcBalance = await acct.btc.balance(address);
          sat += BigInt(btcBalance.confirmedSat) + BigInt(btcBalance.unconfirmedSat);
        }
        btcDecimal = atomsToDecimal(sat.toString(), 8);
      } catch (e) {
        if (!(e instanceof IndexerError && e.kind === 'transport')) throw e;
      }
    }
    pushAsset(assetRow('BTC', 'Bitcoin', 'Bitcoin', btcDecimal, snapshots.get('BTC') ?? null, await sparkFor(price, 'BTC'), btcUnavailable), btcDecimal);

    for (const entry of portfolio.tokens) {
      if (nftIds.has(entry.tokenId)) continue; // NFT units live on the NFTs tab.
      const meta = await acct.balance.tokenMeta(entry.tokenId);
      const ticker = meta.ticker ?? null;
      const decimal = atomsToDecimal(entry.atoms, meta.decimals);
      pushAsset(
        assetRow(
          ticker ?? entry.tokenId,
          ticker ?? t('home.tokens.unknown'),
          'Mintlayer',
          decimal,
          snapshots.get(entry.tokenId) ?? null,
          await sparkFor(price, ticker ?? entry.tokenId),
        ),
        decimal,
      );
    }

    const total = builds.reduce((sum, build) => sum + build.row.value, 0);
    const delta = builds.reduce((sum, build) => sum + (build.row.value * build.row.change) / 100, 0);
    const change = total > 0 ? (delta / total) * 100 : 0;
    const spark = await price.getHistory('PORTFOLIO', '1D').then((points) => points.map((p) => p.p));
    const bundle: HomeBundle = {
      portfolio: {
        total: formatAmount(total.toFixed(2), { maxFrac: 2, trimZeros: false }),
        change,
        delta: `${delta >= 0 ? '+' : '-'}${formatUsd(Math.abs(delta).toFixed(2))} · 24h`,
        spark: spark.length > 0 ? spark : builds[0]?.row.spark ?? [],
      },
      assets: builds.map((build) => build.row),
      balances: Object.fromEntries(
        builds.map((build) => [build.row.sym, `${formatAmount(build.decimal, { maxFrac: 8 })} ${build.row.sym}`]),
      ),
      nfts: await nftRows(acct.nfts, [...nftIds]),
      loadedAt: Date.now(),
    };
    homeCache = bundle;
    return bundle;
  }

  async function nftRows(nfts: NftService, ids: string[]): Promise<NftRow[]> {
    const rows: NftRow[] = [];
    for (const id of ids) {
      const info = await nfts.metadata(id);
      rows.push({
        id,
        name: info?.name ?? null,
        ticker: info?.ticker ?? null,
        owner: info?.owner ?? null,
        mediaUri: info?.mediaUri ?? null,
        iconUri: info?.iconUri ?? null,
        metadataMissing: info === null,
      });
    }
    return rows;
  }

  return {
    getPortfolio: async (opts) => (await loadHome(opts)).portfolio,
    getAssets: async (opts) => (await loadHome(opts)).assets,
    getAssetSymbols: async () => (await loadHome()).assets.map((row) => row.sym),
    getAssetBalances: async () => (await loadHome()).balances,
    getActivity: async (limit) => {
      requireIndexerBase();
      const acct = await ensureAccount();
      if (!acct.activity) throw new IndexerError('transport', 'indexer', undefined);
      return acct.activity.rows(limit);
    },
    getNfts: async (opts) => (await loadHome(opts)).nfts,
    // Bitcoin stays a connected network only while its backend exists: an
    // unconfigured btc-api base (F13) must not list a chain with no data
    // behind it.
    getNetworks: async (): Promise<ChainName[]> => (cfg.btcBase ? ['Bitcoin', 'Mintlayer'] : ['Mintlayer']),
    getRanges: async () => [...RANGES],
    // The fixture identity stays mock-mode only: real mode derives the
    // profile from the first ML address and the actual network count, so no
    // screen presents a demo name or demo address as the user's wallet.
    getProfile: async () => {
      const acct = await ensureAccount();
      const ml = truncateMiddle(await acct.manager.currentReceivingAddress('ml'));
      return {
        name: ml,
        initial: (ml[0] ?? 'M').toUpperCase(),
        address: ml,
        chains: cfg.btcBase ? 2 : 1,
      };
    },
    getMarket: async () => MARKET,
    getOrderBook: async () => ({ asks: [...ASKS], bids: [...BIDS] }),
    getTimeframes: async () => [...TIMEFRAMES],
    getHtlcSteps: async () => [...HTLC_STEPS],
    getSwapStats: async () => SWAP_STATS,
    getBridgeChains: async () => [...BRIDGE_CHAINS],
    getBridgeRoute: async () => [...BRIDGE_ROUTE],
    getBridgeQuote: async () => BRIDGE_QUOTE,
    getWaitlist: async () => WAITLIST,
    getDapps: async () => DAPPS,
    getCardFeatures: async () => fixtureData.getCardFeatures(),
    getCardTiers: async () => fixtureData.getCardTiers(),
    getFees: async () => FEES,
    getContacts: async () => [...CONTACTS],
    getAddresses: async () => {
      const acct = await ensureAccount();
      const [ml, btc] = await Promise.all([
        acct.manager.currentReceivingAddress('ml'),
        acct.manager.currentReceivingAddress('btc'),
      ]);
      return { Mintlayer: ml, Bitcoin: btc };
    },
    getChainGlyphs: async () => CHAIN_GLYPH,
    getPrices: (tokenIds) => price.getSnapshots(tokenIds),
  };
}

/** Display asset row: number conversion happens exactly here, at the render
 *  boundary of the existing AssetRow contract. `unavailable` marks a chain
 *  whose backend is unconfigured (unknown amount, not zero). */
function assetRow(
  sym: string,
  name: string,
  chain: ChainName,
  decimal: string,
  snapshot: PriceSnapshot | null,
  spark: number[],
  unavailable = false,
): AssetRow {
  const amt = Number(decimal);
  const price = snapshot ? Number(snapshot.usd) : 0;
  return {
    sym,
    name,
    chain,
    amt,
    price,
    change: snapshot?.change24hPct ?? 0,
    value: amt * price,
    spark,
    unavailable: unavailable || undefined,
  };
}

async function sparkFor(price: PriceProvider, tokenId: string): Promise<number[]> {
  const points = await price.getHistory(tokenId, '1D');
  return points.slice(-9).map((p) => p.p);
}
