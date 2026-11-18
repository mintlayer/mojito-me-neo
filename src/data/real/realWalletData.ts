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
import { ML_DECIMALS, atomsToDecimal, decimalsToAtoms, formatAmount, formatUsd } from '../../money';
import { IndexerError } from '../ml/IndexerClient';
import type { AssetRow, NftRow, PriceProvider, PriceSnapshot, WalletData } from '../providers/types';
import type { AccountServices, RealAccountContext, RealAccountConfig } from './account';
import { CHAIN_GLYPH, DAPPS, FEES, RANGES, TIMEFRAMES } from '../../data';
import { localWaitlistCounter } from '../mock/localWaitlist';
import { truncateMiddle } from '../../ui/format';
import { createFixtureWalletData } from '../mock/fixtures';
import { createFixturePriceProvider } from '../mock/priceFixtures';

/** How long one home bundle (portfolio, assets, nfts) is shared between calls. */
const HOME_CACHE_MS = 5_000;

export type RealWalletDataConfig = RealAccountConfig;

type AssetBuild = { row: AssetRow; decimal: string };

type HomeBundle = {
  portfolio: { total: string; change: number; delta: string; spark: number[] };
  assets: AssetRow[];
  /** Exact decimal strings per symbol, for the picker subtitle contract. */
  balances: Record<string, string>;
  nfts: NftRow[];
  loadedAt: number;
};

export function createRealWalletData(context: RealAccountContext): WalletData {
  const fixtureData = createFixtureWalletData();
  const price = createFixturePriceProvider();
  const cfg = context.cfg;
  const ensureAccount = context.ensureAccount;
  const requireIndexer = context.requireIndexer;
  let homeCache: HomeBundle | null = null;

  /** One shared scan for portfolio, assets and NFTs, memoized briefly. A
   *  force call (pull-to-refresh) bypasses the cache window. */
  async function loadHome(opts?: { force?: boolean }): Promise<HomeBundle> {
    requireIndexer();
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
      // Same-ticker assets (two tokens sharing a ticker) get a numbered
      // suffix so the display symbol, and with it the React key, stays
      // unique; a fixed " 2" would collide with the next duplicate.
      let sym = row.sym;
      for (let n = 2; usedSymbols.has(sym); n++) sym = `${row.sym} ${n}`;
      row.sym = sym;
      usedSymbols.add(sym);
      builds.push({ row, decimal });
    };

    const mlDecimal = atomsToDecimal(portfolio.coinAtoms, ML_DECIMALS);
    pushAsset(assetRow('ML', 'Mintlayer', 'Mintlayer', mlDecimal, snapshots.get('ML') ?? null, await sparkFor(price, 'ML'), false, { decimals: ML_DECIMALS }), mlDecimal);

    let btcDecimal = '0';
    let btcPending: string | undefined;
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
        // earlier addresses would otherwise read as zero. The unconfirmed
        // share is surfaced separately: the send path refuses unconfirmed
        // external receipts, so the row must not read as spendable.
        const addresses = await acct.manager.allAddresses('btc');
        let sat = 0n;
        let pendingSat = 0n;
        for (const address of addresses) {
          const btcBalance = await acct.btc.balance(address);
          sat += BigInt(btcBalance.confirmedSat) + BigInt(btcBalance.unconfirmedSat);
          pendingSat += BigInt(btcBalance.unconfirmedSat);
        }
        btcDecimal = atomsToDecimal(sat.toString(), 8);
        // Esplora serves a negative unconfirmed figure while an outgoing
        // mempool spend nets against it: only an inflight receipt is copy.
        btcPending = pendingSat > 0n ? atomsToDecimal(pendingSat.toString(), 8) : undefined;
      } catch (e) {
        // Any configured-backend failure (transport, http after retries, a
        // parse rule) degrades to the zero BTC row while the ML surfaces
        // keep rendering; the failure surfaces through the offline banner,
        // not a crash of the whole home bundle.
        if (!(e instanceof IndexerError)) throw e;
      }
    }
    pushAsset(
      assetRow('BTC', 'Bitcoin', 'Bitcoin', btcDecimal, snapshots.get('BTC') ?? null, await sparkFor(price, 'BTC'), btcUnavailable, {
        decimals: 8,
        pending: btcPending,
      }),
      btcDecimal,
    );

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
          false,
          { decimals: meta.decimals, tokenId: entry.tokenId },
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

  async function nftRows(nfts: NonNullable<AccountServices['nfts']>, ids: string[]): Promise<NftRow[]> {
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
      requireIndexer();
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
    // M4: the market header derives from the R1 price provider (still the
    // mock source, so the figures stay indicative and the screens disclose
    // pricesAreMock); high, low and volume derive from the 1d candles the
    // same source serves. A snapshot miss answers null: the header renders
    // a typed unavailable state, never a fixture row.
    getMarket: async (pair) => {
      const [snapshots, candles] = await Promise.all([price.getSnapshots(['ML', 'BTC']), price.getCandles(pair, '1d')]);
      const ml = snapshots.find((s) => s.tokenId === 'ML');
      const btc = snapshots.find((s) => s.tokenId === 'BTC');
      if (!ml) return null;
      const highDecimal = candles.reduce((acc, c) => (BigInt(decimalsToAtoms(c.h, 11)) > BigInt(decimalsToAtoms(acc, 11)) ? c.h : acc), candles[0]?.h ?? '0');
      const lowDecimal = candles.reduce((acc, c) => (BigInt(decimalsToAtoms(c.l, 11)) < BigInt(decimalsToAtoms(acc, 11)) ? c.l : acc), candles[0]?.h ?? '0');
      const volumeAtoms = candles.reduce((acc, c) => acc + BigInt(decimalsToAtoms(c.v, 11)), 0n);
      const btcRatio = btc && ml.usd !== '0' ? (Number(ml.usd) / Number(btc.usd)).toFixed(7) : null;
      return {
        pair,
        last: formatUsd(ml.usd),
        change: ml.change24hPct,
        btc: btcRatio !== null ? `≈ ${btcRatio} BTC` : '',
        high: formatUsd(highDecimal),
        low: formatUsd(lowDecimal),
        volume: `24h vol ${formatUsd(atomsToDecimal(volumeAtoms.toString(), 11), { compact: true })}`,
        price: Number(ml.usd),
      };
    },
    // F6: tickers are not unique, so placement disambiguates on the full
    // id list instead of guessing the first row.
    getTokenIds: async (ticker) => {
      const indexer = requireIndexer();
      return indexer.tokensByTicker(ticker);
    },
    getTokenMeta: async (tokenId) => {
      const acct = await ensureAccount();
      if (!acct.balance) return null;
      try {
        return await acct.balance.tokenMeta(tokenId);
      } catch {
        return null;
      }
    },
    getTimeframes: async () => [...TIMEFRAMES],
    // R4: the taken counter is the local waitlist store's state (seed plus
    // one while this install holds its slot), not a static fixture number.
    getWaitlist: async () => localWaitlistCounter(),
    getDapps: async () => DAPPS,
    getCardFeatures: async () => fixtureData.getCardFeatures(),
    getCardTiers: async () => fixtureData.getCardTiers(),
    getFees: async () => FEES,
    getContacts: async () => [], // contacts are a mock-only affordance (M3 spec moves them past v2); real mode ships none
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
  extra?: { decimals: number; tokenId?: string; pending?: string },
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
    decimals: extra?.decimals,
    tokenId: extra?.tokenId,
    pending: extra?.pending,
  };
}

async function sparkFor(price: PriceProvider, tokenId: string): Promise<number[]> {
  const points = await price.getHistory(tokenId, '1D');
  return points.slice(-9).map((p) => p.p);
}
