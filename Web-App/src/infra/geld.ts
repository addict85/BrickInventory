/** In Zehntausendsteln (NUMERIC(12,4)), gerundet erst am Ende: 120,3333 × 2
 * bleibt 240,67; toFixed() rundet 1,005 dagegen auf 1,00. */

import { fehlerWerfen, type FehlerCode } from './fehlerTexte';

/** null heisst „unbekannt", nicht 0. */
export type Zehntel4 = number;

const FAKTOR = 10_000;

export function inZehntel4(betrag: unknown): Zehntel4 | null {
  if (betrag === null || betrag === undefined || betrag === '') return null;
  const n = typeof betrag === 'number' ? betrag : Number(String(betrag).replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * FAKTOR) : null;
}

/** Punkt oder Komma, höchstens vier Nachkommastellen, kein Tausendertrenner:
 * „1,5“ und „1.5“ sind dasselbe, „1.234,5“ ist mehrdeutig und wird abgelehnt. */
export const GELD_TEXT = /^\s*-?\d{1,12}(?:[.,]\d{1,4})?\s*$/;

/** Die eine Lesart einer Geldeingabe (Vertrag: eingabe.geld).
 * @returns null für „kein Betrag“ (fehlt, null, leer), sonst der Betrag auf vier Stellen */
export function geldEingabe(v: unknown, feld: string, max = 1_000_000, einCode?: FehlerCode): number | null {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null;
  const n =
    typeof v === 'number' ? v : typeof v === 'string' && GELD_TEXT.test(v) ? Number(v.trim().replace(',', '.')) : NaN;
  // Ein eigener Code (Gutscheine) gilt für jede Abweisung, den kennen die Apps dort.
  if (!Number.isFinite(n)) fehlerWerfen(einCode ?? 'betrag_ungueltig', 400);
  if (n < 0) fehlerWerfen(einCode ?? 'feld_negativ', 400, { feld });
  if (n > max) fehlerWerfen(einCode ?? 'feld_zu_hoch', 400, { feld });
  return Math.round(n * FAKTOR) / FAKTOR;
}

/** Halbe Rappen von der Null weg. */
export function aufRappen(z: Zehntel4): number {
  const rappen = Math.sign(z) * Math.round(Math.abs(z) / 100);
  return rappen / 100 || 0;
}

/** Der Stückpreis wird vorher nicht gerundet. */
export function zeilenwert(stueckpreis: unknown, menge: number): number | null {
  const z = inZehntel4(stueckpreis);
  return z === null ? null : aufRappen(z * menge);
}

/** Zeilen ohne Preis zählen nicht. */
export function summeAus(zeilen: Iterable<{ preis: unknown; menge: number }>): number {
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
