// Shared amount-to-atoms resolution for the money services: indexer payloads
// legitimately carry atoms-only, decimal-only or both shapes (parseAmount),
// so consumers must never read .atoms alone or silently treat a missing
// field as zero-scale value. Coin callers pass the chain decimals (ML 11);
// token callers pass the decimals from token metadata.
import { decimalsToAtoms } from '../money';
import type { AmountJson } from './ml/types';

/**
 * Atoms string for one parsed amount: the atoms field when present,
 * otherwise the decimal field rescaled to the given decimals. An absent
 * amount (an optional output leg) counts as zero.
 */
export function atomsOf(amount: AmountJson | undefined, decimals: number): string {
  if (amount?.atoms !== undefined) return amount.atoms;
  if (amount?.decimal !== undefined) return decimalsToAtoms(amount.decimal, decimals);
  return '0';
}
