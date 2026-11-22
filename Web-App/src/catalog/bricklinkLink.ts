// BrickLink lists gear and books differently from Rebrickable; the link must know that.
import { logAndContinue } from '../infra/error';
import { withVersion, withoutVersion } from '../infra/setNumber';
import type { CatalogContext } from './context';

export type BlType = 'SET' | 'GEAR' | 'BOOK' | 'MINIFIG' | 'NONE';

export interface BlLink {
  type: BlType;
  /** Gear/Book without -N suffix. */
  number: string;
  /** ALWAYS set: a button that disappears is worse than one that
   * leads to the search. */
  url: string;
  exact: boolean;
  /** false if the type was never resolved against BrickLink (assumption: SET). */
  resolved: boolean;
}

// The spelling comes from src/infra/setNumber.ts, not from a third version.
export function withVariant(setNumber: string): string {
  return withVersion(String(setNumber || '').trim());
}

export function bareNumber(setNumber: string): string {
  return withoutVersion(String(setNumber || '').trim());
}

const PARAM: Record<Exclude<BlType, 'NONE'>, string> = { SET: 'S', GEAR: 'G', BOOK: 'B', MINIFIG: 'M' };

export function blAddress(type: BlType, number: string): string | null {
  if (type === 'NONE') return null;
  const p = PARAM[type];
  // #T=<p> opens the "For Sale" tab directly, O={"iconly":0} the list view.
  return (
    `https://www.bricklink.com/v2/catalog/catalogitem.page?${p}=${encodeURIComponent(number)}` +
    `#T=${p}&O={%22iconly%22:0}`
  );
}

// Without an unambiguous mapping (e.g. collectible minifigures) a search instead of a wrong link.
export function blSearchUrl(number: string): string {
  return `https://www.bricklink.com/v2/search.page?q=${encodeURIComponent(bareNumber(number))}`;
}

const KNOWN: BlType[] = ['SET', 'GEAR', 'BOOK', 'MINIFIG', 'NONE'];

function toLink(setNumber: string, blType: string | null | undefined): BlLink {
  const type = KNOWN.includes(blType as BlType) ? (blType as BlType) : null;
  // Without a cache entry, SET is the right assumption for the vast majority.
  const effective: BlType = type ?? 'SET';
  const number = effective === 'SET' ? withVariant(setNumber) : bareNumber(setNumber);
  const exactUrl = blAddress(effective, number);
  // 'NONE' only means "not found as set, gear or book" — that applies to
  // collectible minifigures, and for them the button must not disappear.
  return exactUrl
    ? { type: effective, number, url: exactUrl, exact: true, resolved: type !== null }
    : { type: effective, number, url: blSearchUrl(setNumber), exact: false, resolved: type !== null };
}

/** One query instead of N single queries, for list and catalog pages.
 * @returns Map keyed by the Rebrickable spelling (with -N) */
export async function resolveMany(kx: CatalogContext, setNumbers: string[]): Promise<Map<string, BlLink>> {
  const out = new Map<string, BlLink>();
  const keys = [...new Set((setNumbers || []).filter(Boolean).map(withVariant))];
  if (keys.length === 0) return out;

  const rows = await kx.catalogCache.blTypesTheSets(keys);

  const byNumber = new Map<string, string | null>();
  for (const r of rows) byNumber.set(r.set_number, r.bl_type);
  for (const k of keys) out.set(k, toLink(k, byNumber.get(k)));
  return out;
}

/** Thin wrapper over resolveMany so that there is only one logic. */
export async function resolveSingle(k: CatalogContext, setNumber: string): Promise<BlLink> {
  const m = await resolveMany(k, [setNumber]);
  return m.get(withVariant(setNumber)) as BlLink;
}

/** The same chain as for the price lookup (set → gear → book → NONE), but via
 * /items — cheaper when only the type matters. */
export async function resolveViaInterface(k: CatalogContext, setNumber: string): Promise<BlLink> {
  const n = withVariant(setNumber);
  const bare = bareNumber(setNumber);

  // Without access stay with the assumption, cache nothing.
  if (!(await k.settings.globalValue('bricklink_consumer_key'))) return toLink(n, null);

  const notFound = (e: unknown) =>
    [404, 400].includes((e as { detail?: { meta?: { code?: number } } } | null)?.detail?.meta?.code ?? 0);

  const probe = async (type: Exclude<BlType, 'NONE'>, no: string) => {
    try {
      await k.externalSources.sources.bricklinkRequest('GET', `/items/${type.toLowerCase()}/${no}`);
      return true;
    } catch (e) {
      if (notFound(e)) return false;
      throw e;
    }
  };

  let found: BlType = 'NONE';
  try {
    if (await probe('SET', n)) found = 'SET';
    else if (await probe('GEAR', bare)) found = 'GEAR';
    else if (await probe('BOOK', bare)) found = 'BOOK';
    // MINIFIG only hits if BrickLink happens to list the same number; otherwise
    // it stays NONE and the search link applies.
    else if (await probe('MINIFIG', bare)) found = 'MINIFIG';
  } catch (_) {
    // Network or rate-limit errors: do not cache, so that it can be retried later.
    return toLink(n, null);
  }

  await k.catalogCache.rememberBlType(n, found, found === 'NONE').catch(logAndContinue('bl-link:probe'));
  return toLink(n, found);
}
