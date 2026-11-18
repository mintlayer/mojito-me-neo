// Shared USD math: one rounding rule for every approx-dollar figure so screen
// calculations cannot drift apart. Rendering goes through common.approxUsd.
/** USD value of amount (raw number or decimal string) at price, 2 decimals. */
export function usd(amount: string | number, price: number): string {
  const value = (typeof amount === 'string' ? parseFloat(amount || '0') : amount) * price;
  return (Number.isFinite(value) ? value : 0).toFixed(2);
}

/** Middle-truncate a long identifier for display: first 10 chars, ellipsis,
 *  last 6, ids up to 18 chars kept whole. Address rows and profile chips. */
export function truncateMiddle(id: string, head = 10, tail = 6): string {
  return id.length <= head + tail + 2 ? id : `${id.slice(0, head)}…${id.slice(-tail)}`;
}

/** Quantize a float product into a display amount string. Percent-picked
 *  balances (balance * fraction) carry binary float tails; clamp negatives
 *  and non-finite values to zero, round to the asset's decimals (8 for
 *  ML/BTC-style assets, the AssetRow default) and strip trailing zeros. */
export function quantizeAmount(value: number, decimals = 8): string {
  const clean = Number.isFinite(value) && value > 0 ? value : 0;
  const fixed = clean.toFixed(decimals);
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}
