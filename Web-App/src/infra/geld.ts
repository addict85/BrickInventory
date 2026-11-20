/** In Zehntausendsteln (NUMERIC(12,4)), gerundet erst am Ende: 120,3333 × 2
 * bleibt 240,67; toFixed() rundet 1,005 dagegen auf 1,00. */

import { fachfehler, type ErrorCode } from './errorTexts';

/** null heisst „unbekannt", nicht 0. */
export type Zehntel4 = number;

const FACTOR = 10_000;

export function inZehntel4(betrag: unknown): Zehntel4 | null {
  if (betrag === null || betrag === undefined || betrag === '') return null;
  const n = typeof betrag === 'number' ? betrag : Number(String(betrag).replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * FACTOR) : null;
}

/** Punkt oder Komma, höchstens vier Nachkommastellen, kein Tausendertrenner:
 * „1,5“ und „1.5“ sind dasselbe, „1.234,5“ ist mehrdeutig und wird abgelehnt. */
export const GELD_TEXT = /^\s*-?\d{1,12}(?:[.,]\d{1,4})?\s*$/;

/** Die eine Lesart einer Geldeingabe (Vertrag: eingabe.geld).
 * @returns null für „kein Betrag“ (fehlt, null, leer), sonst der Betrag auf vier Stellen */
export function moneyInput(v: unknown, feld: string, max = 1_000_000, oneCode?: ErrorCode): number | null {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null;
  const n =
    typeof v === 'number' ? v : typeof v === 'string' && GELD_TEXT.test(v) ? Number(v.trim().replace(',', '.')) : NaN;
  // Ein eigener Code (Gutscheine) gilt für jede Abweisung, den kennen die Apps dort.
  if (!Number.isFinite(n)) fachfehler('ungueltig', oneCode ?? 'betrag_ungueltig');
  if (n < 0) fachfehler('ungueltig', oneCode ?? 'feld_negativ', { feld });
  if (n > max) fachfehler('ungueltig', oneCode ?? 'feld_zu_hoch', { feld });
  return Math.round(n * FACTOR) / FACTOR;
}

/** Halbe Rappen von der Null weg. */
export function aufRappen(z: Zehntel4): number {
  const rappen = Math.sign(z) * Math.round(Math.abs(z) / 100);
  return rappen / 100 || 0;
}

/** Der Stückpreis wird vorher nicht gerundet. */
export function zeilenwert(unitPrice: unknown, menge: number): number | null {
  const z = inZehntel4(unitPrice);
  return z === null ? null : aufRappen(z * menge);
}

/** Zeilen ohne Preis zählen nicht. */
export function sumFrom(zeilen: Iterable<{ preis: unknown; menge: number }>): number {
  let z = 0;
  for (const r of zeilen) {
    const p = inZehntel4(r.preis);
    if (p !== null) z += p * r.menge;
  }
  return aufRappen(z);
}

export function alsText(betrag: unknown): string | null {
  const z = inZehntel4(betrag);
  return z === null ? null : aufRappen(z).toFixed(2);
}
