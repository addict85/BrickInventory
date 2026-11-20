/** Die eine Stelle für die Schreibweise: Zwei Schreibweisen trafen
 * verschiedene Zeilen in Katalog und Cache. */

// Prüft den Versionsanhang, nicht jeden Strich.
export function withVersion(setNumber: string | number): string {
  const s = String(setNumber);
  return /-\d+$/.test(s) ? s : `${s}-1`;
}

// Eine Fassung für Barcode, Feld, CSV.
export function normalisiereSetNummer(input: unknown): string {
  let s = ((String(input).trim().split(';')[0] ?? '').trim().split(' ')[0] ?? '').trim().replace(/[^a-zA-Z0-9-]/g, '');
  if (!/-\d+$/.test(s)) s = s + '-1';
  return s;
}

/** Mindestens eine Ziffer: „abc" wurde sonst still zu „abc-1" und als Set ohne
 * Daten angelegt; echte Nummern wie „comcon001" tragen alle eine Ziffer. */
export function possibleSetNumber(normalisiert: string): boolean {
  return /^(?=[A-Za-z]*\d)[A-Za-z0-9]{1,20}-\d{1,3}$/.test(normalisiert);
}

export function withoutVersion(setNumber: string | number): string {
  return withVersion(setNumber).replace(/-\d+$/, '');
}

// Der Leser steht hier, weil die Markierung unter der Nummer MIT Anhang liegt
// (src/katalog/bricklinkPreise.ts) und drei Stellen verschieden fragten.
interface CatalogEntry {
  is_gear?: boolean | null;
  bl_type?: string | null;
  fetched_at?: string | Date | null;
}

/** Dann braucht es den Abruf nicht: Er kostet Kontingent und endet ohnehin im Fehler. */
export function withoutBricklinkPrice(eintrag: CatalogEntry | null | undefined, jetzt = Date.now()): boolean {
  if (!(eintrag?.is_gear === true && eintrag?.bl_type === 'NONE')) return false;
  // Nur eine Weile: Ein neues Set steht oft erst Tage nach dem Erscheinen im
  // BrickLink-Katalog.
  const seit = eintrag.fetched_at ? new Date(eintrag.fetched_at).getTime() : NaN;
  return Number.isFinite(seit) && jetzt - seit < UNKNOWN_APPLIES_DAYS * 86_400_000;
}

export const UNKNOWN_APPLIES_DAYS = 7;
