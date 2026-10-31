/**
 * Geldbeträge rechnen in ganzen Zehntausendsteln (die Genauigkeit von
 * NUMERIC(12,4)) und runden erst am Ende auf Rappen, kaufmännisch. So bleibt
 * 120,3333 × 2 = 240,67 und wird nicht über einen gerundeten Stückpreis zu
 * 240,66; toFixed() auf einer Gleitkommazahl rundet 1,005 dagegen auf 1,00.
 */

/** Ein Betrag in Zehntausendsteln; null heisst „unbekannt“, nicht 0. */
export type Zehntel4 = number;

const FAKTOR = 10_000;

/** Betrag (Zahl oder NUMERIC-Text) → Zehntausendstel. Leer oder unlesbar ist null. */
export function inZehntel4(betrag: unknown): Zehntel4 | null {
  if (betrag === null || betrag === undefined || betrag === '') return null;
  const n = typeof betrag === 'number' ? betrag : Number(String(betrag).replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * FAKTOR) : null;
}

/** Zehntausendstel → Betrag auf Rappen gerundet, halbe Rappen von der Null weg. */
export function aufRappen(z: Zehntel4): number {
  const rappen = Math.sign(z) * Math.round(Math.abs(z) / 100);
  return rappen / 100 || 0;
}

/** Stückpreis × Menge, auf Rappen gerundet — der Stückpreis wird vorher nicht gerundet. */
export function zeilenwert(stueckpreis: unknown, menge: number): number | null {
  const z = inZehntel4(stueckpreis);
  return z === null ? null : aufRappen(z * menge);
}

/** Summe von Stückpreis × Menge über viele Zeilen; Zeilen ohne Preis zählen nicht. */
export function summeAus(zeilen: Iterable<{ preis: unknown; menge: number }>): number {
  let z = 0;
  for (const r of zeilen) {
    const p = inZehntel4(r.preis);
    if (p !== null) z += p * r.menge;
  }
  return aufRappen(z);
}

/** Betrag als Text mit zwei Stellen, für Felder, die ihn als Zeichenkette führen. */
export function alsText(betrag: unknown): string | null {
  const z = inZehntel4(betrag);
  return z === null ? null : aufRappen(z).toFixed(2);
}
