// Price and sanity guards shared by the order and swap entry points (spec
// M4: order entry guards). Pure string/BigInt math on decimal amounts: no
// float, no provider state, fully offline-testable. Every guard returns a
// typed result the UI maps to its own copy; the raw detail strings are
// developer diagnostics, never rendered directly.
import { decimalsToAtoms } from '../money';

export type GuardReason = 'slippage' | 'minSize' | 'amount' | 'timelock';

export type GuardResult = { ok: true } | { ok: false; reason: GuardReason; detail: string };

/** The swap timelock safety margin (spec security note: the ML refund
 *  timelock must be at least margin times the BTC timelock). */
export const DEFAULT_SAFETY_MARGIN = 2;

/** Compare decimal strings exactly on a common 11-decimal scale. */
function compareDecimals(a: string, b: string): number {
  const aAtoms = BigInt(decimalsToAtoms(a, 11));
  const bAtoms = BigInt(decimalsToAtoms(b, 11));
  return aAtoms === bAtoms ? 0 : aAtoms > bAtoms ? 1 : -1;
}

/** Positive, parseable decimal on both legs of an order or swap. */
export function checkAmounts(params: { giveDecimal: string; askDecimal: string }): GuardResult {
  for (const [label, value] of [['give', params.giveDecimal], ['ask', params.askDecimal]] as const) {
    let atoms: bigint;
    try {
      atoms = BigInt(decimalsToAtoms(value, 11));
    } catch {
      return { ok: false, reason: 'amount', detail: `${label} amount is not a decimal number` };
    }
    if (atoms <= 0n) return { ok: false, reason: 'amount', detail: `${label} amount must be greater than zero` };
  }
  return { ok: true };
}

/** Slippage guard against the book mid (spec: order entry guards). The
 *  limit must sit within maxSlippagePct of the mid in either direction; a
 *  crossed or far-off price rejects before any transaction is built. */
export function checkSlippage(params: { limitDecimal: string; midDecimal: string; maxSlippagePct: number }): GuardResult {
  let limit: bigint;
  let mid: bigint;
  try {
    limit = BigInt(decimalsToAtoms(params.limitDecimal, 11));
    mid = BigInt(decimalsToAtoms(params.midDecimal, 11));
  } catch {
    return { ok: false, reason: 'slippage', detail: 'price not parseable' };
  }
  if (mid <= 0n) return { ok: false, reason: 'slippage', detail: 'book mid is not a usable price' };
  // basis points: |limit - mid| / mid * 10000; exact BigInt comparison.
  const driftBps = ((limit > mid ? limit - mid : mid - limit) * 10000n) / mid;
  const maxBps = BigInt(Math.max(0, Math.round(params.maxSlippagePct * 100)));
  if (driftBps > maxBps) {
    return { ok: false, reason: 'slippage', detail: `price drifted ${Number(driftBps) / 100}% from the book mid` };
  }
  return { ok: true };
}

/** Minimum fill size guard: the requested fill must reach the configured
 *  floor (dust fills waste fees and fragment the book). */
export function checkMinFill(params: { amountDecimal: string; minDecimal: string }): GuardResult {
  let cmp: number;
  try {
    cmp = compareDecimals(params.amountDecimal, params.minDecimal);
  } catch {
    return { ok: false, reason: 'minSize', detail: 'fill amount is not a decimal number' };
  }
  if (cmp < 0) return { ok: false, reason: 'minSize', detail: `fill is below the ${params.minDecimal} minimum` };
  return { ok: true };
}

/** TIMELOCK_RULE (F10): the Bitcoin timelock must be shorter than the
 *  Mintlayer one; the UI enforces the safety margin before initiating. */
export function checkTimelockRule(params: { mlSeconds: number; btcSeconds: number; margin?: number }): GuardResult {
  const margin = params.margin ?? DEFAULT_SAFETY_MARGIN;
  if (!Number.isFinite(params.mlSeconds) || !Number.isFinite(params.btcSeconds) || params.mlSeconds <= 0 || params.btcSeconds <= 0) {
    return { ok: false, reason: 'timelock', detail: 'timelocks must be positive second counts' };
  }
  if (params.btcSeconds * margin > params.mlSeconds) {
    return { ok: false, reason: 'timelock', detail: `the Bitcoin timelock must be at most 1/${margin} of the Mintlayer timelock` };
  }
  return { ok: true };
}
