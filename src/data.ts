// Mock fixtures for the demo UI. Lifted out of the per-screen JSX in the source
// design so screens stay presentational and nothing is declared twice.

import type { ActivityRow, AssetRow, CandleInterval, PriceRange } from './data/providers/types';
import type { IconName } from './ui/icons';
import type { StepState } from './ui/StepState';
import type { ChainName, Tone } from './theme';

export const PROFILE = {
  name: 'satoshi.ml',
  initial: 'S',
  address: '0x9c3FA8…D8aFF',
  chains: 5,
};

export const BALANCE = {
  total: '58,880.04',
  change: 3.42,
  delta: '+$1,946.21 · 24h',
  spark: [120, 124, 122, 130, 128, 138, 134, 142, 148, 145, 152, 158, 154, 162, 168, 172],
};

export const RANGES: PriceRange[] = ['1H', '4H', '1D', '1W', '1M', '1Y', 'ALL'];

export const ASSETS: AssetRow[] = [
  { sym: 'BTC', name: 'Bitcoin', chain: 'Bitcoin', amt: 0.4821, price: 96420.32, change: 2.18, value: 46485.57, spark: [100, 102, 99, 105, 108, 106, 112, 110, 115] },
  { sym: 'ML', name: 'Mintlayer', chain: 'Mintlayer', amt: 12480.5, price: 0.342, change: 8.42, value: 4268.33, spark: [80, 82, 78, 85, 90, 95, 92, 98, 105] },
  { sym: 'USDT', name: 'Tether (ML)', chain: 'Mintlayer', amt: 1240.0, price: 1.0, change: 0.01, value: 1240.0, spark: [100, 100, 100, 100, 100, 100, 100, 100, 100] },
];

/** Picker subtitles. Declared once so the format can't drift per screen. */
export const ASSET_BALANCES = Object.fromEntries(ASSETS.map((a) => [a.sym, `${a.amt.toLocaleString()} ${a.sym}`]));

export const ASSET_SYMBOLS = ASSETS.map((a) => a.sym);

// EVM demo chains (Ethereum, Arbitrum, Polygon, BNB) were removed in M2 per
// the M2 spec: no wallet backend exists for them. The bridge fixtures keep
// their R5 pair until M4 wires bridge_v2 wholesale.
export const NETWORKS: readonly ChainName[] = ['Bitcoin', 'Mintlayer'];

export const ACTIVITY: ActivityRow[] = [
  { icon: 'bridge', title: 'Bridge to Arbitrum', sub: '120 ML → 41.04 USDC', tone: 'violet', time: '2m', state: 'Confirming · 3/12', live: true },
  { icon: 'swap', title: 'Swap on Mintlayer DEX', sub: '0.012 BTC → 3,420 ML', tone: 'amber', time: '14m', state: 'Filled · +0.4%', live: false },
  { icon: 'arrow_dn', title: 'Atomic swap received', sub: '+ 0.0184 BTC', tone: 'green', time: '1h', state: 'Settled', live: false },
];

/* ── DEX ─────────────────────────────────────────────────── */

export const MARKET = {
  pair: 'ML/USDT',
  last: '0.3435',
  change: 8.42,
  btc: '≈ 0.0000036 BTC',
  high: '0.3492',
  low: '0.3168',
  volume: '24h vol $4.82M · 218 markets',
  price: 0.3438,
};

export const ASKS = [
  { p: 0.3458, s: 12480, t: 4313 },
  { p: 0.3452, s: 8420, t: 2906 },
  { p: 0.3448, s: 32140, t: 11078 },
  { p: 0.3444, s: 5210, t: 1794 },
  { p: 0.3441, s: 18200, t: 6262 },
  { p: 0.3438, s: 2480, t: 853 },
] satisfies { p: number; s: number; t: number }[];

export const BIDS = [
  { p: 0.3432, s: 4810, t: 1651 },
  { p: 0.3428, s: 12120, t: 4154 },
  { p: 0.3425, s: 28480, t: 9754 },
  { p: 0.3421, s: 6280, t: 2148 },
  { p: 0.3418, s: 14860, t: 5079 },
  { p: 0.3414, s: 3210, t: 1096 },
] satisfies { p: number; s: number; t: number }[];

export const TIMEFRAMES: CandleInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

/* ── Swap ────────────────────────────────────────────────── */

export const HTLC_STEPS = [
  { label: 'Initiate swap', detail: 'Generate secret hash · lock 0.025 BTC', state: 'done' },
  { label: 'Counterparty matched', detail: 'Mintlayer node locks 7,012.45 ML', state: 'done' },
  { label: 'Reveal preimage on Mintlayer', detail: 'Claim ML, hash exposed onchain', state: 'active', note: '~3 min' },
  { label: 'Counterparty claims BTC', detail: 'Settles atomically', state: 'pending' },
] satisfies { label: string; detail: string; state: StepState; note?: string }[];

export const SWAP_STATS = [
  ['Rate', '1 BTC = 280,498 ML'],
  ['Slippage', '0.18%'],
  ['Timelock', '24h refund'],
  ['Est. time', '~18 min'],
] satisfies [string, string][];

/* ── Bridge ──────────────────────────────────────────────── */

export const BRIDGE_CHAINS = [
  { name: 'Mintlayer', sym: 'ML' },
  { name: 'Bitcoin', sym: 'BTC' },
  { name: 'Ethereum', sym: 'ETH' },
  { name: 'Arbitrum', sym: 'ARB' },
  { name: 'Polygon', sym: 'POL' },
  { name: 'BNB', sym: 'BNB' },
] satisfies { name: ChainName; sym: string }[];

/** Arbitrum-side mint contract shown in the route and the bridge fixture. */
export const BRIDGE_CONTRACT = '0xA1c2…F39e';

export const BRIDGE_ROUTE = [
  { label: 'Lock on Mintlayer', detail: 'mojito.mlbridge.v2', icon: 'lock', eta: '~15s' },
  { label: 'Validator attestation', detail: '7 of 11 signatures', icon: 'shield', eta: '~45s' },
  { label: 'Mint on Arbitrum', detail: `${BRIDGE_CONTRACT} (mUSDT)`, icon: 'flash', eta: '~5s' },
] satisfies { label: string; detail: string; icon: IconName; eta: string }[];

export const BRIDGE_QUOTE = [
  ['Bridge fee', '0.15% · $0.75'],
  ['Est. time', '~65 sec'],
  ['You receive', '499.25 USDT'],
  ['Gas (ARB)', '0.00012 ETH'],
] satisfies [string, string][];

/* ── Card ────────────────────────────────────────────────── */

export const WAITLIST = { taken: 12847, total: 25000 };

/** Connected-dApp demo state for Settings. */
export const DAPPS = { active: 3 };

export const CARD_FEATURES = [
  { icon: 'flash', title: 'Spend onchain', detail: 'Instant ML + BTC settlement', tone: 'amber' },
  { icon: 'bridge', title: 'Auto-route', detail: 'Best fee across chains', tone: 'violet' },
  { icon: 'shield', title: 'Self-custody', detail: 'Your keys, your card', tone: 'teal' },
  { icon: 'arrow_dn', title: 'Cashback', detail: 'Up to 4% back in ML', tone: 'green' },
] satisfies { icon: IconName; title: string; detail: string; tone: Tone }[];

export const CARD_TIERS = [
  { name: 'Steel', stake: '0 ML', cashback: '1%', active: true },
  { name: 'Gold', stake: '5,000 ML', cashback: '2.5%' },
  { name: 'Black', stake: '50,000 ML', cashback: '4%' },
] satisfies { name: string; stake: string; cashback: string; active?: boolean }[];

/* ── Send / Receive ──────────────────────────────────────── */

export const FEES = {
  economy: { cost: 0.00008 },
  standard: { cost: 0.00012 },
  fast: { cost: 0.00024 },
};

export const CONTACTS = [
  { name: 'Alice', address: 'mtc1qkv9d8t4xu2nx5pqxe2u3a8mw0g7e0a' },
  { name: 'Eng wallet', address: '0x9c3FA84B0EE2F71a0c1d8B6F421Bd' },
  { name: 'Coinbase', address: '0x71a0Ee2f9c3FA84B0EE2F71a0c1d8B' },
] satisfies { name: string; address: string }[];

// Synthetic demo addresses: not real, not funded. (No BNB receive address in
// the demo; Partial keeps the chain set honest without inventing one.)
export const ADDRESSES = {
  Mintlayer: 'mtc1qkv9d8t4xu2nx5pqxe2u3a8mw0g7e0a4ftpqlsm',
  Bitcoin: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
} satisfies Partial<Record<ChainName, string>>;

export const CHAIN_GLYPH = {
  Bitcoin: '₿',
  Mintlayer: 'Ⓜ',
} satisfies Partial<Record<ChainName, string>>;

// Onboarding fixtures live in src/onboarding/data.ts; see that file for the
// recovery phrase, BIP39 list and account-discovery results.
