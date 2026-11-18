// Portfolio aggregation across the derived ML receiving and change
// addresses (spec M2): coin balance plus MLS-01 token balances straight from
// the indexer address summaries (api-coverage notes finding 2), summed on
// BigInt atom strings. Address scanning is sequential, one request per
// address, rate-limit friendly per the spec security note. Token metadata
// (ticker, decimals) is cached in session memory only.
import { IndexerClient, IndexerError } from './IndexerClient';
import { atomsOf } from '../amount';
import { ML_DECIMALS } from '../../money';

export type MlTokenBalance = { tokenId: string; atoms: string };

export type MlPortfolio = {
  /** Summed spendable coin atoms across every scanned address. */
  coinAtoms: string;
  lockedCoinAtoms: string;
  tokens: MlTokenBalance[];
};

export type MlTokenMeta = { ticker: string | null; decimals: number };

export class BalanceService {
  private readonly client: IndexerClient;

  private readonly addresses: () => Promise<string[]>;

  private readonly metaCache = new Map<string, MlTokenMeta>();

  constructor(client: IndexerClient, addresses: () => Promise<string[]>) {
    this.client = client;
    this.addresses = addresses;
  }

  /**
   * Portfolio across all derived addresses. A fresh (never funded) address
   * answers 404 upstream and the client maps that to the zero form, so an
   * unused address never becomes an error path.
   */
  async portfolio(): Promise<MlPortfolio> {
    const addresses = await this.addresses();
    let coin = 0n;
    let locked = 0n;
    const tokenAtoms = new Map<string, bigint>();
    for (const address of addresses) {
      const info = await this.client.addressInfo(address);
      coin += BigInt(atomsOf(info.coinBalance, ML_DECIMALS));
      locked += BigInt(atomsOf(info.lockedCoinBalance, ML_DECIMALS));
      for (const entry of info.tokens) {
        const current = tokenAtoms.get(entry.tokenId) ?? 0n;
        tokenAtoms.set(entry.tokenId, current + BigInt(await this.tokenAtomsOf(entry.tokenId, entry.amount)));
      }
    }
    return {
      coinAtoms: coin.toString(),
      lockedCoinAtoms: locked.toString(),
      tokens: [...tokenAtoms.entries()].map(([tokenId, atoms]) => ({ tokenId, atoms: atoms.toString() })),
    };
  }

  /** Atoms for one address token entry: atoms directly, or the decimal
   *  field rescaled through the cached token metadata decimals. */
  private async tokenAtomsOf(tokenId: string, amount: { atoms?: string; decimal?: string }): Promise<string> {
    if (amount.atoms !== undefined) return amount.atoms;
    const meta = await this.tokenMeta(tokenId);
    return atomsOf(amount, meta.decimals);
  }

  /** Ticker and decimals for a token id, cached per session. */
  async tokenMeta(tokenId: string): Promise<MlTokenMeta> {
    const cached = this.metaCache.get(tokenId);
    if (cached) return cached;
    let meta: MlTokenMeta;
    try {
      const info = await this.client.token(tokenId);
      meta = { ticker: info.ticker, decimals: info.decimals };
    } catch (e) {
      // A metadata miss (unknown or unindexed id) must not kill the balance
      // row: fall back to the raw id with Mintlayer-scale 0 units.
      if (e instanceof IndexerError && e.kind === 'http' && e.status === 404) {
        meta = { ticker: null, decimals: 0 };
      } else {
        throw e;
      }
    }
    this.metaCache.set(tokenId, meta);
    return meta;
  }
}
