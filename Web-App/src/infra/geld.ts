/** In Zehntausendsteln (NUMERIC(12,4)), gerundet erst am Ende: 120,3333 × 2
 * bleibt 240,67; toFixed() rundet 1,005 dagegen auf 1,00. */

/** null heisst „unbekannt", nicht 0. */
export type Zehntel4 = number;

const FAKTOR = 10_000;

export function inZehntel4(betrag: unknown): Zehntel4 | null {
  if (betrag === null || betrag === undefined || betrag === '') return null;
  const n = typeof betrag === 'number' ? betrag : Number(String(betrag).replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * FAKTOR) : null;
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
