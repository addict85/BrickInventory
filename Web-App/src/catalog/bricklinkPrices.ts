/** This is where the decision is made under which kind (set, gear, book) to
 * ask; the catalog remembers the answer so that the next lookup asks
 * correctly right away. */
import { asFetchError } from '../externalSources';
import { withVersion, withoutBricklinkPrice, withoutVersion } from '../infra/setNumber';
import { failDomain } from '../infra/errorTexts';
import type { CatalogEntry } from './repository/catalogCache';
import type { CatalogContext } from './context';

export type PriceRecord = { avg_price?: unknown; qty_avg_price?: unknown } | null | undefined;

/** THE market price rule (SQL: marktpreisSql): avg_price, otherwise qty_avg_price, 0 is not a
 * price; a quantity average proves sales. String(): BrickLink responses carry text, too. */
export function marketPriceFrom(row: PriceRecord): number | null {
  const avg = parseFloat(String(row?.avg_price ?? ''));
  if (avg > 0) return avg;
  const qty = parseFloat(String(row?.qty_avg_price ?? ''));
  return qty > 0 ? qty : null;
}

export function hatPrice(row: PriceRecord): boolean {
  return marketPriceFrom(row) !== null;
}

export type { CatalogEntry };

export function setKnownInCatalog(k: CatalogContext, setNumber: string): Promise<boolean> {
  return k.katalogCache.setInCatalog(withVersion(setNumber));
}

/** Under the spelling it is stored under. */
export function catalogEntry(k: CatalogContext, setNumber: string): Promise<CatalogEntry | null> {
  return k.katalogCache.catalogEntryTo(withVersion(setNumber));
}

/** Not found or invalid: then the next kind. */
const tryNext = (e: unknown) => {
  const c = asFetchError(e).detail?.meta?.code;
  return c === 404 || c === 400;
};

// Default 'N': without a condition the used price used to be fetched and cached.
async function getPriceGuideRaw(
  k: CatalogContext,
  setNumber: string,
  condition = 'N',
  guideType = 'sold',
  currencyCode = 'EUR',
) {
  const n = withVersion(setNumber);
  const bare = withoutVersion(n);
  const params = { guide_type: guideType, new_or_used: condition, currency_code: currencyCode, vat: 'N' };
  const cached = await catalogEntry(k, n);
  if (cached?.bl_type === 'GEAR')
    return await k.externalSources.quellen.bricklinkRequest('GET', `/items/gear/${bare}/price`, params);
  if (cached?.bl_type === 'BOOK')
    return await k.externalSources.quellen.bricklinkRequest('GET', `/items/book/${bare}/price`, params);
  if (withoutBricklinkPrice(cached)) failDomain('nicht_gefunden', 'kein_bricklink_preis');
  try {
    return await k.externalSources.quellen.bricklinkRequest('GET', `/items/set/${n}/price`, params);
  } catch (e) {
    if (!tryNext(e)) throw e;
  }
  for (const art of ['GEAR', 'BOOK'] as const) {
    try {
      const result = await k.externalSources.quellen.bricklinkRequest(
        'GET',
        `/items/${art.toLowerCase()}/${bare}/price`,
        params,
      );
      await k.katalogCache.rememberBricklinkKind(n, art);
      return result;
    } catch (e) {
      if (!tryNext(e)) throw e;
    }
  }
  await k.katalogCache.rememberBricklinkKind(n, 'NONE');
  throw new Error(`${n} nicht auf BrickLink gefunden (Set/Gear/Book) — kein Preis`);
}

// Sales first, otherwise offers: rarely traded items would otherwise never have a price.
export async function priceGuideQuery(
  k: CatalogContext,
  setNumber: string,
  condition = 'N',
  guideType = 'sold',
  currencyCode = 'EUR',
) {
  const first = await getPriceGuideRaw(k, setNumber, condition, guideType, currencyCode);
  if (hatPrice(first) || guideType !== 'sold') {
    return { ...first, guide_used: guideType };
  }
  // No sale in six months → use current offers.
  try {
    const alt = await getPriceGuideRaw(k, setNumber, condition, 'stock', currencyCode);
    if (hatPrice(alt)) return { ...alt, guide_used: 'stock', guide_fallback: true };
  } catch (_) {
    /* Fallback is optional — then the result stays empty */
  }
  return { ...first, guide_used: guideType };
}

// Without a number, the whole store.
export async function clearSubsetsCache(k: CatalogContext, sn: string | null = null) {
  await k.katalogCache.emptySubsetsCache(sn ? withVersion(sn) : null);
}

export async function clearCatalogCache(k: CatalogContext, sn: string | null = null) {
  await k.katalogCache.emptyCatalogCache(sn ? withVersion(sn) : null);
}

export const getCacheStats = (k: CatalogContext) => k.katalogCache.cacheNumbers();
