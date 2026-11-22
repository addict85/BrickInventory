/** THE one place for the spelling: two spellings hit
 * different rows in catalog and cache. */

// Checks the version suffix, not every dash.
export function withVersion(setNumber: string | number): string {
  const s = String(setNumber);
  return /-\d+$/.test(s) ? s : `${s}-1`;
}

// One version for barcode, field, CSV.
export function normalizeSetNumber(input: unknown): string {
  let s = ((String(input).trim().split(';')[0] ?? '').trim().split(' ')[0] ?? '').trim().replace(/[^a-zA-Z0-9-]/g, '');
  if (!/-\d+$/.test(s)) s = s + '-1';
  return s;
}

/** At least one digit: "abc" otherwise silently became "abc-1" and was created as a set without
 * data; real numbers like "comcon001" all carry a digit. */
export function possibleSetNumber(normalized: string): boolean {
  return /^(?=[A-Za-z]*\d)[A-Za-z0-9]{1,20}-\d{1,3}$/.test(normalized);
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
export function withoutBricklinkPrice(entry: CatalogEntry | null | undefined, now = Date.now()): boolean {
  if (!(entry?.is_gear === true && entry?.bl_type === 'NONE')) return false;
  // Only for a while: a new set often appears in the BrickLink catalog only days
  // after its release.
  const since = entry.fetched_at ? new Date(entry.fetched_at).getTime() : NaN;
  return Number.isFinite(since) && now - since < UNKNOWN_APPLIES_DAYS * 86_400_000;
}

export const UNKNOWN_APPLIES_DAYS = 7;
