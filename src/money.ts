// Atom and decimal string helpers (decisions.md F4 and F9): amounts cross
// the chain, the indexer and storage as decimal atom strings, and every
// arithmetic on them runs on BigInt with pure string parsing and formatting.
// No float value ever represents money here; Number() conversions live only
// at the UI render boundary, never inside these helpers or provider state.

/** Mintlayer coin decimals (F4): 1 ML = 1e11 atoms. */
export const ML_DECIMALS = 11;

export type FormatAmountOptions = { maxFrac?: number; trimZeros?: boolean };

export type FormatUsdOptions = { compact?: boolean };

const DECIMAL_SHAPE = /^[+-]?(\d+)(?:\.(\d*))?$/;

type ParsedDecimal = { negative: boolean; int: string; frac: string };

/** Strict decimal-string parse; throws on e-notation, empty strings and
 *  anything that is not an exact decimal literal. */
function parseDecimal(decimal: string): ParsedDecimal {
  const text = decimal.trim();
  const match = DECIMAL_SHAPE.exec(text);
  if (!match) throw new Error(`not an exact decimal string: ${decimal}`);
  const negative = text.startsWith('-');
  return { negative, int: match[1], frac: match[2] ?? '' };
}

function magnitudeIsZero(int: string, frac: string): boolean {
  return /^0*$/.test(int) && /^0*$/.test(frac);
}

/** Group the integer digits with commas: '1234567' -> '1,234,567'. */
function groupDigits(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Round half up (away from zero) a parsed magnitude to maxFrac fraction
 * digits, entirely on digit strings. Returns at least one integer digit.
 */
function roundFrac(int: string, frac: string, maxFrac: number): { int: string; frac: string } {
  const scaledDigits = int + frac.slice(0, maxFrac).padEnd(maxFrac, '0');
  const dropped = frac.slice(maxFrac);
  let scaled = BigInt(scaledDigits === '' ? '0' : scaledDigits);
  if (dropped.length > 0 && dropped[0] >= '5') scaled += 1n;
  const text = scaled.toString().padStart(maxFrac + 1, '0');
  return { int: text.slice(0, text.length - maxFrac), frac: text.slice(text.length - maxFrac) };
}

/**
 * Divide a parsed magnitude by 10^shift, rounding half up to one fraction
 * digit, on digit strings: the engine behind the compact USD forms.
 */
function divideMagnitude(int: string, frac: string, shift: number): string {
  const digits = int + frac;
  const kept = digits.slice(0, digits.length - shift);
  const dropped = digits.slice(digits.length - shift);
  let scaled = BigInt(kept === '' ? '0' : kept);
  if (dropped.length > 0 && dropped[0] >= '5') scaled += 1n;
  const text = scaled.toString().padStart(2, '0');
  return `${text.slice(0, -1)}.${text.slice(-1)}`;
}

/** Atoms string to a decimal string at the given scale: ('100000000', 8) -> '1'.
 *  Trailing zeros are trimmed, so the result never carries float-style tails. */
export function atomsToDecimal(atoms: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`decimals must be a non-negative integer: ${decimals}`);
  }
  const text = atoms.trim();
  if (!/^[+-]?\d+$/.test(text)) throw new Error(`not an atom string: ${atoms}`);
  const negative = text.startsWith('-');
  const digits = (negative ? text.slice(1) : text).replace(/^0+(?=\d)/, '');
  let out: string;
  if (decimals === 0) {
    out = digits;
  } else {
    const padded = digits.padStart(decimals + 1, '0');
    const int = padded.slice(0, padded.length - decimals).replace(/^0+(?=\d)/, '');
    const frac = padded.slice(padded.length - decimals).replace(/0+$/, '');
    out = frac.length > 0 ? `${int}.${frac}` : int;
  }
  if (negative && out !== '0' && !/^0\.0*$/.test(out)) out = `-${out}`;
  return out;
}

/** Decimal string to an atoms string at the given scale: ('1', 8) -> '100000000'.
 *  Extra precision beyond the scale rounds half up (away from zero), so
 *  '0.000000000005' at 11 decimals becomes 1 atom. Exact, never a float. */
export function decimalsToAtoms(decimal: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`decimals must be a non-negative integer: ${decimals}`);
  }
  const { negative, int, frac } = parseDecimal(decimal);
  const padded = frac.slice(0, decimals).padEnd(decimals, '0');
  const dropped = frac.slice(decimals);
  let magnitude = BigInt(int + padded);
  if (dropped.length > 0 && dropped[0] >= '5') magnitude += 1n;
  return `${negative ? '-' : ''}${magnitude.toString()}`;
}

/** Display formatting for a decimal string: grouping, capped fraction digits,
 *  optional zero trimming. ('12480.5') -> '12,480.5'. */
export function formatAmount(decimal: string, opts?: FormatAmountOptions): string {
  const maxFrac = opts?.maxFrac ?? 6;
  const trimZeros = opts?.trimZeros ?? true;
  if (!Number.isInteger(maxFrac) || maxFrac < 0) {
    throw new Error(`maxFrac must be a non-negative integer: ${maxFrac}`);
  }
  const parsed = parseDecimal(decimal);
  const { int, frac } = roundFrac(parsed.int, parsed.frac, maxFrac);
  let fracText = frac;
  if (trimZeros) fracText = fracText.replace(/0+$/, '');
  const sign = parsed.negative && !magnitudeIsZero(int, fracText) ? '-' : '';
  return fracText.length > 0 ? `${sign}${groupDigits(int)}.${fracText}` : `${sign}${groupDigits(int)}`;
}

/** USD display: '$' prefix, two fraction digits; compact shrinks large
 *  magnitudes to $1.2M / $12.3K forms. All arithmetic is string based. */
export function formatUsd(decimal: string, opts?: FormatUsdOptions): string {
  const compact = opts?.compact ?? false;
  if (!compact) return `$${formatAmount(decimal, { maxFrac: 2, trimZeros: false })}`;
  const { negative, int, frac } = parseDecimal(decimal);
  if (magnitudeIsZero(int, frac)) return '$0';
  // Compact branch reads the integer digit count; the division shifts by the
  // fraction scale so value/1e6 (or /1e3) lands on one fraction digit.
  const intDigits = int.replace(/^0+(?=\d)/, '').length;
  const sign = negative ? '-' : '';
  if (intDigits > 6) return `$${sign}${divideMagnitude(int, frac, frac.length + 5)}M`;
  if (intDigits > 3) return `$${sign}${divideMagnitude(int, frac, frac.length + 2)}K`;
  return `$${formatAmount(decimal, { maxFrac: 2, trimZeros: false })}`;
}
