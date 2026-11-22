/** In ten-thousandths (NUMERIC(12,4)), rounded only at the end: 120.3333 × 2
 * stays 240.67; toFixed() on the other hand rounds 1.005 to 1.00. */

import { fachfehler, type ErrorCode } from './errorTexts';

/** null means "unknown", not 0. */
export type TenThousandths = number;

const FACTOR = 10_000;

export function inTenThousandths(amount: unknown): TenThousandths | null {
  if (amount === null || amount === undefined || amount === '') return null;
  const n = typeof amount === 'number' ? amount : Number(String(amount).replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * FACTOR) : null;
}

/** Dot or comma, at most four decimal places, no thousands separator:
 * "1,5" and "1.5" are the same, "1.234,5" is ambiguous and is rejected. */
export const GELD_TEXT = /^\s*-?\d{1,12}(?:[.,]\d{1,4})?\s*$/;

/** THE one reading of a money input (contract: eingabe.geld).
 * @returns null for "no amount" (missing, null, empty), otherwise the amount to four places */
export function moneyInput(v: unknown, feld: string, max = 1_000_000, oneCode?: ErrorCode): number | null {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null;
  const n =
    typeof v === 'number' ? v : typeof v === 'string' && GELD_TEXT.test(v) ? Number(v.trim().replace(',', '.')) : NaN;
  // An own code (vouchers) applies to every rejection; the apps know it there.
  if (!Number.isFinite(n)) fachfehler('ungueltig', oneCode ?? 'betrag_ungueltig');
  if (n < 0) fachfehler('ungueltig', oneCode ?? 'feld_negativ', { feld });
  if (n > max) fachfehler('ungueltig', oneCode ?? 'feld_zu_hoch', { feld });
  return Math.round(n * FACTOR) / FACTOR;
}

/** Half cents away from zero. */
export function aufRappen(z: TenThousandths): number {
  const rappen = Math.sign(z) * Math.round(Math.abs(z) / 100);
  return rappen / 100 || 0;
}

/** The unit price is not rounded beforehand. */
export function zeilenwert(unitPrice: unknown, menge: number): number | null {
  const z = inTenThousandths(unitPrice);
  return z === null ? null : aufRappen(z * menge);
}

/** Rows without a price do not count. */
export function sumFrom(rows: Iterable<{ preis: unknown; menge: number }>): number {
  let z = 0;
  for (const r of rows) {
    const p = inTenThousandths(r.preis);
    if (p !== null) z += p * r.menge;
  }
  return aufRappen(z);
}

export function alsText(amount: unknown): string | null {
  const z = inTenThousandths(amount);
  return z === null ? null : aufRappen(z).toFixed(2);
}
