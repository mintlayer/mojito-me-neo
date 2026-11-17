// Unified activity assembly (spec M2): Mintlayer rows from indexer tx
// history with resolved inputs and outputs (direction against our derived
// address set), Bitcoin rows from the btc-api Esplora-shaped history, mapped
// onto the existing ActivityRow contract. Mapping happens through t() so the
// rows carry no hardcoded copy, and amounts stay decimal strings produced by
// the money helpers.
import type { BtcChainService } from '../btc/BtcChainService';
import { IndexerClient } from '../ml/IndexerClient';
import type { MlTransaction } from '../ml/types';
import type { MlTokenMeta } from '../ml/BalanceService';
import { ML_DECIMALS, atomsToDecimal, formatAmount } from '../../money';
import { t } from '../../i18n';
import type { ActivityRow } from '../providers/types';

export type ActivityKind = 'send' | 'receive' | 'htlc';

export type ActivityChain = 'ml' | 'btc';

export type ActivityEntry = {
  id: string;
  chain: ActivityChain;
  kind: ActivityKind;
  /** Human amount, unsigned; the direction rides in kind. */
  amountDecimal: string;
  symbol: string;
  /** Null while pending; numeric once confirmed. */
  confirmations: number | null;
  /** Unix seconds; null while pending. */
  timestampSeconds: number | null;
};

export type ActivityServiceDeps = {
  ml?: {
    client: IndexerClient;
    addresses: () => Promise<string[]>;
    /** Token metadata for rows that move MLS-01 tokens instead of coin. */
    tokenMeta: (tokenId: string) => Promise<MlTokenMeta>;
  };
  btc?: {
    client: BtcChainService;
    addresses: () => Promise<string[]>;
  };
  /** Per-refresh cap on single-transaction lookups. */
  maxLookups?: number;
};

const DEFAULT_MAX_LOOKUPS = 30;

/** Short relative time ('2m', '1h', '3d'), the row `time` contract. */
export function relativeTime(seconds: number | null, nowSeconds: number): string {
  if (seconds === null || nowSeconds <= seconds) return t('activity.time.now');
  const minutes = Math.floor((nowSeconds - seconds) / 60);
  if (minutes < 1) return t('activity.time.now');
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export class ActivityService {
  private readonly ml?: NonNullable<ActivityServiceDeps['ml']>;

  private readonly btc?: NonNullable<ActivityServiceDeps['btc']>;

  private readonly maxLookups: number;

  constructor(deps: ActivityServiceDeps) {
    this.ml = deps.ml;
    this.btc = deps.btc;
    this.maxLookups = deps.maxLookups ?? DEFAULT_MAX_LOOKUPS;
  }

  /** Merged entries, pending first then newest first, capped at limit. */
  async entries(limit: number, nowSeconds = Math.floor(Date.now() / 1000)): Promise<ActivityEntry[]> {
    const [mlEntries, btcEntries] = await Promise.all([
      this.ml ? this.mlEntries() : Promise.resolve([]),
      this.btc ? this.btcEntries() : Promise.resolve([]),
    ]);
    const merged = [...mlEntries, ...btcEntries].sort((a, b) => {
      if (a.timestampSeconds === null && b.timestampSeconds === null) return 0;
      if (a.timestampSeconds === null) return -1;
      if (b.timestampSeconds === null) return 1;
      return b.timestampSeconds - a.timestampSeconds;
    });
    return merged.slice(0, limit);
  }

  /** UI rows on the existing ActivityRow contract. */
  async rows(limit: number, nowSeconds = Math.floor(Date.now() / 1000)): Promise<ActivityRow[]> {
    const entries = await this.entries(limit, nowSeconds);
    return entries.map((entry) => {
      const icon = entry.kind === 'receive' ? 'arrow_dn' : entry.kind === 'htlc' ? 'swap' : 'arrow_up';
      const title = entry.kind === 'receive'
        ? t('activity.row.receive')
        : entry.kind === 'htlc'
          ? t('activity.row.htlc')
          : t('activity.row.send');
      const sign = entry.kind === 'receive' ? '+' : '-';
      const sub = `${sign} ${formatAmount(entry.amountDecimal, { maxFrac: entry.chain === 'btc' ? 8 : ML_DECIMALS })} ${entry.symbol}`;
      const live = entry.confirmations === null;
      const state = entry.confirmations === null
        ? t('activity.state.pending')
        : entry.confirmations === 0
          ? t('activity.state.confirmed')
          : t('activity.state.confirmations', { count: entry.confirmations });
      return {
        icon,
        title,
        sub,
        tone: entry.kind === 'receive' ? 'green' : entry.kind === 'htlc' ? 'amber' : 'red',
        time: relativeTime(entry.timestampSeconds, nowSeconds),
        state,
        live,
      };
    });
  }

  private async mlEntries(): Promise<ActivityEntry[]> {
    const ml = this.ml;
    if (!ml) return [];
    const addresses = await ml.addresses();
    const mine = new Set(addresses);
    // History ids arrive newest first per address; dedupe across addresses.
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const address of addresses) {
      const info = await ml.client.addressInfo(address);
      for (const id of info.transactionHistory) {
        if (!seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    }
    const out: ActivityEntry[] = [];
    for (const id of ids.slice(0, this.maxLookups)) {
      const tx = await ml.client.transaction(id);
      const entry = await mapMlTransaction(tx, mine, (tokenId) => ml.tokenMeta(tokenId));
      if (entry) out.push(entry);
    }
    return out;
  }

  private async btcEntries(): Promise<ActivityEntry[]> {
    if (!this.btc) return [];
    const addresses = await this.btc.addresses();
    const out: ActivityEntry[] = [];
    const seen = new Set<string>();
    for (const address of addresses) {
      const confirmed = await this.btc.client.txs(address);
      const mempool = await this.btc.client.txs(address, { mempool: true });
      for (const tx of [...mempool, ...confirmed]) {
        if (seen.has(tx.txid)) continue;
        seen.add(tx.txid);
        const inbound = tx.vout
          .filter((o) => o.address === address)
          .reduce((sum, o) => sum + BigInt(o.valueSat), 0n);
        const outbound = tx.vin
          .filter((i) => i.address === address)
          .reduce((sum, i) => sum + BigInt(i.valueSat), 0n);
        if (outbound === 0n && inbound === 0n) continue;
        if (outbound > 0n) {
          const amount = outbound - inbound;
          // Pure self-transfers (change rounds back exactly) are noise.
          if (amount <= 0n) continue;
          out.push({
            id: tx.txid,
            chain: 'btc',
            kind: 'send',
            amountDecimal: atomsToDecimal(amount.toString(), 8),
            symbol: 'BTC',
            // Esplora carries no confirmation count: 0 renders as plain
            // Confirmed in the row mapping, null as Pending.
            confirmations: tx.confirmed ? 0 : null,
            timestampSeconds: tx.blockTime,
          });
        } else {
          out.push({
            id: tx.txid,
            chain: 'btc',
            kind: 'receive',
            amountDecimal: atomsToDecimal(inbound.toString(), 8),
            symbol: 'BTC',
            confirmations: tx.confirmed ? 0 : null,
            timestampSeconds: tx.blockTime,
          });
        }
      }
    }
    return out;
  }
}

/**
 * Direction and amount of one Mintlayer transaction against our addresses:
 * coin flows first; a token-only movement falls back to the first token leg
 * with its ticker. Zero-value bookkeeping transactions (delegations, order
 * commands) are skipped rather than shown as empty rows.
 */
async function mapMlTransaction(
  tx: MlTransaction,
  mine: Set<string>,
  tokenMeta: (tokenId: string) => Promise<MlTokenMeta>,
): Promise<ActivityEntry | null> {
  const inputFromMe = tx.inputs.some((input) => input.utxo?.destination !== undefined && mine.has(input.utxo.destination));
  const coinOut = (toMe: boolean): bigint =>
    tx.outputs
      .filter((o) => o.value?.type === 'Coin' && o.destination !== undefined && mine.has(o.destination) === toMe)
      .reduce((sum, o) => sum + BigInt(o.value?.amount?.atoms ?? '0'), 0n);
  const toMe = coinOut(true);
  const toOthers = coinOut(false);
  const isHtlc = tx.outputs.some((o) => o.type === 'Htlc') || tx.inputs.some((i) => i.utxo?.type === 'Htlc');

  let kind: ActivityKind;
  let atoms: bigint;
  if (isHtlc) {
    kind = 'htlc';
    atoms = toMe > 0n ? toMe : toOthers;
  } else if (inputFromMe) {
    kind = 'send';
    atoms = toOthers;
  } else {
    kind = 'receive';
    atoms = toMe;
  }

  let amountDecimal: string;
  let symbol: string;
  if (atoms > 0n) {
    amountDecimal = atomsToDecimal(atoms.toString(), ML_DECIMALS);
    symbol = 'ML';
  } else {
    // Token-only movement: read the first token leg in the row's direction.
    const wantToMe = kind !== 'send';
    const tokenOutput = tx.outputs.find(
      (o) => o.value?.type === 'TokenV1' && o.value.tokenId !== undefined && o.destination !== undefined && mine.has(o.destination) === wantToMe,
    );
    if (!tokenOutput || !tokenOutput.value?.tokenId || !tokenOutput.value.amount?.atoms) return null;
    const meta: MlTokenMeta = await tokenMeta(tokenOutput.value.tokenId);
    amountDecimal = atomsToDecimal(tokenOutput.value.amount.atoms, meta.decimals);
    symbol = meta.ticker ?? tokenOutput.value.tokenId;
  }

  return {
    id: tx.id,
    chain: 'ml',
    kind,
    amountDecimal,
    symbol,
    confirmations: tx.confirmations,
    timestampSeconds: tx.timestamp,
  };
}
