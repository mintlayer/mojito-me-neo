// Shared USD math: one rounding rule for every approx-dollar figure so screen
// calculations cannot drift apart. Rendering goes through common.approxUsd.
/** USD value of amount (raw number or decimal string) at price, 2 decimals. */
export function usd(amount: string | number, price: number): string {
  const value = (typeof amount === 'string' ? parseFloat(amount || '0') : amount) * price;
  return value.toFixed(2);
}
