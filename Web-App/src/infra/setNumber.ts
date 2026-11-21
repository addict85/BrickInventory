/** THE one place for the spelling: two spellings hit
 * different rows in catalog and cache. */

// Checks the version suffix, not every dash.
export function withVersion(setNumber: string | number): string {
  const s = String(setNumber);
  return /-\d+$/.test(s) ? s : `${s}-1`;
}

// One version for barcode, field, CSV.
export function normalisiereSetNummer(input: unknown): string {
  let s = ((String(input).trim().split(';')[0] ?? '').trim().split(' ')[0] ?? '').trim().replace(/[^a-zA-Z0-9-]/g, '');
  if (!/-\d+$/.test(s)) s = s + '-1';
  return s;
}

/** At least one digit: "abc" otherwise silently became "abc-1" and was created as a set without
 * data; real numbers like "comcon001" all carry a digit. */
export function possibleSetNumber(normalisiert: string): boolean {
  return /^(?=[A-Za-z]*\d)[A-Za-z0-9]{1,20}-\d{1,3}$/.test(normalisiert);
}

export function withoutVersion(setNumber: string | number): string {
  return withVersion(setNumber).replace(/-\d+$/, '');
}

// The reader lives here because the marker lies under the number WITH suffix
// (src/catalog/bricklinkPrices.ts) and three places asked differently.
interface CatalogEntry {
  is_gear?: boolean | null;
  bl_type?: string | null;
  fetched_at?: string | Date | null;
}

/** Then the fetch is not needed: it costs quota and ends in an error anyway. */
export function withoutBricklinkPrice(eintrag: CatalogEntry | null | undefined, jetzt = Date.now()): boolean {
  if (!(eintrag?.is_gear === true && eintrag?.bl_type === 'NONE')) return false;
  // Only for a while: a new set often appears in the BrickLink catalog only days
  // after its release.
  const seit = eintrag.fetched_at ? new Date(eintrag.fetched_at).getTime() : NaN;
  return Number.isFinite(seit) && jetzt - seit < UNKNOWN_APPLIES_DAYS * 86_400_000;
}

export const UNKNOWN_APPLIES_DAYS = 7;
