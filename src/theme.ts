// Design tokens. The source design is authored in oklch(); React Native has no
// oklch parser, so we convert at module load. Keeping the oklch literals means
// the values stay diffable against the design's styles.css instead of becoming
// opaque hex.

/** oklch -> 'rgb(...)' / 'rgba(...)' */
export function oklch(L: number, c: number, h: number, a = 1): string {
  const hr = (h * Math.PI) / 180;
  const A = c * Math.cos(hr);
  const B = c * Math.sin(hr);

  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;

  const [r, g, b] = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => {
    const e = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, e)) * 255);
  });
  return a === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Re-tint an existing token at a new alpha — the RN stand-in for `oklch(from X l c h / a)`. */
export const alpha = (rgb: string, a: number): string =>
  rgb.replace(/^rgba?\(\s*([\d.]+,\s*[\d.]+,\s*[\d.]+)(?:,\s*[\d.]+)?\s*\)$/, (_, ch) => `rgba(${ch}, ${a})`);

export const white = (a: number): string => `rgba(255, 255, 255, ${a})`;
export const black = (a: number): string => `rgba(0, 0, 0, ${a})`;

export const C = {
  bg0: oklch(0.14, 0.012, 60),
  bg1: oklch(0.18, 0.014, 60),
  bg2: oklch(0.22, 0.014, 60),
  bg3: oklch(0.26, 0.014, 60),
  line: oklch(0.32, 0.012, 60),
  lineSoft: oklch(0.28, 0.01, 60, 0.6),
  text0: oklch(0.98, 0.005, 80),
  text1: oklch(0.82, 0.008, 70),
  text2: oklch(0.6, 0.01, 70),
  text3: oklch(0.45, 0.012, 70),
  amber: oklch(0.82, 0.16, 70),
  teal: oklch(0.82, 0.12, 195),
  violet: oklch(0.74, 0.16, 290),
  green: oklch(0.78, 0.16, 150),
  red: oklch(0.7, 0.2, 25),
  arb: oklch(0.7, 0.13, 230),
  polygon: oklch(0.7, 0.18, 290),
  bnb: oklch(0.85, 0.15, 90),
  cream: '#f5e6cf',
  ink: '#0b0a09',
};

/** A palette key: the `tone`/colour name strings fixtures pass around. */
export type Tone = keyof typeof C;

// Gradient stop lists, mirroring the linear-gradient recipes in styles.css.
export const G = {
  amber: [oklch(0.86, 0.16, 70), oklch(0.74, 0.17, 65)],
  amberDeep: [C.amber, oklch(0.7, 0.17, 60)],
  teal: [oklch(0.86, 0.12, 195), oklch(0.74, 0.13, 200)],
  violet: [oklch(0.78, 0.16, 290), oklch(0.66, 0.17, 290)],
  green: [oklch(0.82, 0.16, 150), oklch(0.7, 0.18, 150)],
  red: [oklch(0.78, 0.2, 25), oklch(0.62, 0.22, 25)],
  surface: [white(0.06), white(0.02)],
  glass: [white(0.04), white(0.02)],
  raised: [oklch(0.24, 0.02, 60), C.bg1],
  raisedTeal: [oklch(0.22, 0.02, 195, 0.4), C.bg1],
  raisedAmber: [oklch(0.22, 0.02, 70, 0.4), C.bg1],
  raisedViolet: [oklch(0.22, 0.02, 290, 0.35), C.bg1],
  raisedGreen: [oklch(0.78, 0.16, 150, 0.18), C.bg1],
  flip: [C.bg2, C.bg1],
  cardBlack: ['#1a1208', '#2a1a08', '#0e0a06'],
  tunnel: [C.teal, oklch(0.95, 0.08, 240), C.violet],
  avatar: [C.amber, C.violet],
  chipGold: [C.amber, oklch(0.6, 0.17, 60)],
  chipSteel: [oklch(0.6, 0.01, 70), oklch(0.4, 0.01, 70)],
  emvChip: [oklch(0.85, 0.08, 80), oklch(0.6, 0.08, 70)],
  splash: [oklch(0.2, 0.014, 60), oklch(0.1, 0.012, 60)],
};

// Per-token identity used by TokenIcon. Indexed by arbitrary symbol strings
// (pickers feed it anything), so unknown symbols fall back at the call site.
export const TOKENS: Record<string, { from: string; to: string; glyph: string }> = {
  BTC: { from: C.amber, to: oklch(0.7, 0.17, 50), glyph: '₿' },
  ML: { from: C.teal, to: oklch(0.7, 0.14, 210), glyph: 'Ⓜ' },
  ETH: { from: oklch(0.74, 0.06, 280), to: oklch(0.55, 0.08, 280), glyph: 'Ξ' },
  USDT: { from: oklch(0.78, 0.13, 160), to: oklch(0.6, 0.12, 160), glyph: '₮' },
  USDC: { from: oklch(0.7, 0.13, 240), to: oklch(0.55, 0.14, 250), glyph: '$' },
  MATIC: { from: C.polygon, to: oklch(0.55, 0.18, 290), glyph: '◆' },
  BNB: { from: C.bnb, to: oklch(0.7, 0.16, 80), glyph: '◈' },
  ARB: { from: C.arb, to: oklch(0.55, 0.14, 230), glyph: '◉' },
  OP: { from: C.red, to: oklch(0.55, 0.2, 20), glyph: '○' },
};

// Per-chain accent, shared by ChainBadge / Receive / Bridge / Home.
export const CHAINS = {
  Mintlayer: C.teal,
  Bitcoin: C.amber,
  Ethereum: C.violet,
  Arbitrum: C.arb,
  Polygon: C.polygon,
  BNB: C.bnb,
};

/** Chains the UI knows an accent for. Unknown chain strings fall back
 *  visibly at the (few) places that index freely. */
export type ChainName = keyof typeof CHAINS;
