/**
 * Money helpers (SPEC section 2): amounts are integer cents everywhere; reais appear only
 * in display and in the LLM interface. Negative or non-finite amounts are rejected with a
 * RangeError, so a bug upstream fails loudly instead of printing "R$ -3,00".
 */

function assertAmount(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite, non-negative number (got ${value})`);
  }
}

/** Converts reais to integer cents, rounding to the nearest cent (`32.905` -> `3291`). */
export function reaisToCents(reais: number): number {
  assertAmount(reais, 'reais');
  // toPrecision(15) removes binary noise such as 1.005 * 100 = 100.49999999999999.
  return Math.round(Number((reais * 100).toPrecision(15)));
}

/** Converts integer cents to reais (a number, e.g. `3290` -> `32.9`). */
export function centsToReais(cents: number): number {
  assertAmount(cents, 'cents');
  if (!Number.isInteger(cents)) throw new RangeError(`cents must be an integer (got ${cents})`);
  return cents / 100;
}

/** Formats cents as `R$ 32,90` (plain space, not the U+00A0 that Intl uses). */
export function formatBRL(cents: number): string {
  centsToReais(cents); // validates
  const whole = Math.floor(cents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = (cents % 100).toString().padStart(2, '0');
  return `R$ ${whole},${fraction}`;
}
