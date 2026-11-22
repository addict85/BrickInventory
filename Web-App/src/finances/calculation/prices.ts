/** The PRICE LAYER of the finance part: BrickLink, price cache, daily quota
 * and BL numbers. A file of its own because valuation and profit calculation stand
 * on it, not the other way round. */

import type { Preiszeile, SetPreiszeile } from '../repository/priceCache';
import { type CatalogEntry, hatPrice, marketPriceFrom } from '../../catalog';
import { asIds } from '../../household';
import { logAndContinue, reportError } from '../../infra/error';
import { DomainError, failDomain } from '../../infra/errorTexts';
import { withVersion, withoutBricklinkPrice } from '../../infra/setNumber';
import { effectiveCondition } from './condition';
import { NO_COLOR } from '../../infra/validate';
import { attempts } from '../../infra/result';
import type { FinancesContext } from '../context';
import type { Clock } from '../../infra/clock';

/** Whose DATA is calculated; whose SETTINGS apply is said by `viewerId`. */
export type { Scope as Blickfeld } from '../../household';

type PriceRow = { avg_price?: unknown; fetched_at?: string | Date | null } | null | undefined;

/** `string | number` because the setting comes from the database as text;
 * the calculators' `parseInt(String(…))` is therefore load-bearing. */
type Hours = string | number;

/** THE condition resolution for a set — one, because several versions of their own
 * had drifted apart. */
export async function conditionOfSet(k: FinancesContext, uid: number | number[], setNumber: string): Promise<'N' | 'U'> {
  // Scope instead of a bare ID: the set often belongs to a sub-account.
  const row = await k.preisCache.setStateCounter(asIds(uid), setNumber);
  return effectiveCondition(row);
}

// 'U', because the used price matches the collection's resale value;
// the other condition serves as fallback.
export const DEFAULT_PRICE_CONDITION = 'U';

/** Shorter than the TTL window so that a fallback (sold → stock) is
 * requested again at all. */
const ZERO_PRICE_TTL_HOURS = 6;

/** The one place that defines "fresh". */
export function emptyPriceCache(k: FinancesContext): Promise<void> {
  return k.preisCache.deleteAllSetPrices();
}

export async function priceFromCache(
  k: FinancesContext,
  setNumber: string,
  condition: string,
  currency: string,
  ttlHours: number,
) {
  return k.preisCache.setPriceFresh(setNumber, condition, currency, ttlHours);
}

export function cacheUsable(row: PriceRow, ttlHours: number, now: number) {
  if (!row) return false;
  // avg_price is numeric, and pg delivers numeric as a string.
  if (hatPrice(row)) return true;
  // 0 entry: trust only briefly, retry afterwards.
  if (!row.fetched_at) return false;
  const ageH = (now - new Date(row.fetched_at).getTime()) / 3600000;
  return ageH < Math.min(ZERO_PRICE_TTL_HOURS, ttlHours);
}

interface PriceFuehrer {
  min_price?: unknown;
  avg_price?: unknown;
  max_price?: unknown;
  qty_avg_price?: unknown;
  total_quantity?: unknown;
}

/** Cache first, then (only with a price) history point. @returns the numbers read */
export async function savePrice(
  k: FinancesContext,
  setNumber: string,
  condition: string,
  currency: string,
  g: PriceFuehrer | null | undefined,
) {
  const min = parseFloat(String(g?.min_price ?? 0)) || 0;
  const avg = parseFloat(String(g?.avg_price ?? 0)) || 0;
  const max = parseFloat(String(g?.max_price ?? 0)) || 0;
  const qavg = parseFloat(String(g?.qty_avg_price ?? 0)) || 0;
  const qty = parseInt(String(g?.total_quantity ?? 0), 10) || 0;

  // A zero is written as well: it is the information "no price" and holds back
  // the next fetch; for how long is decided by cacheUsable().
  const price = { min, avg, max, qavg, qty };
  // Cache and history together: a cache without its history point would hold back
  // the next fetch, and nobody would fill the gap in the history any more.
  await k.transact(async t => {
    await t.preisCache.rememberSetPrice(setNumber, condition, currency, price);
    // The same rule as the job's daily snapshot: a history with two
    // recording rules would have gaps.
    if (hatPrice({ avg_price: avg, qty_avg_price: qavg }))
      await t.preisCache.rememberSetHistory(setNumber, condition, currency, price);
  });
  return price;
}

export interface PriceData {
  min_price: number;
  avg_price: number;
  max_price: number;
  qty_avg_price: number;
  from_cache: boolean;
  condition_used?: string;
  is_fallback?: true;
  /** Freshly checked, but BrickLink knows no price. */
  no_price?: true;
  bl_unbekannt?: true;
  /** Not in the cache: the job "preise_nachladen" fetches it. */
  ausstehend?: true;
  error?: string;
}
type CacheRow = {
  min_price?: unknown;
  avg_price?: unknown;
  max_price?: unknown;
  qty_avg_price?: unknown;
  fetched_at?: string | Date | null;
};
const WITHOUT_PRICE = { min_price: 0, avg_price: 0, max_price: 0, qty_avg_price: 0 } as const;
const numberFrom = (v: unknown) => Number(v) || 0;
/** avg_price carries the market price: all consumers read it, a 0 would appear as "0.00". */
const fromRow = (z: CacheRow, extra: Partial<PriceData> = {}): PriceData => ({
  min_price: numberFrom(z.min_price),
  avg_price: marketPriceFrom(z) ?? 0,
  max_price: numberFrom(z.max_price),
  qty_avg_price: numberFrom(z.qty_avg_price),
  from_cache: true,
  ...extra,
});

/** What distinguishes set, part and figure; all three share the flow. */
interface PriceSource {
  name: string;
  lies(condition: string): Promise<CacheRow | null | undefined> | CacheRow | null | undefined;
  ask(condition: string): Promise<PriceFuehrer | null | undefined>;
  remember(condition: string, g: PriceFuehrer | null | undefined): Promise<CacheRow>;
}

/** null: the fetch failed; whether that is an error is decided by the flow. */
async function fetchCached(q: PriceSource, condition: string): Promise<CacheRow | null> {
  try {
    return await q.remember(condition, await q.ask(condition));
  } catch (e) {
    // Exception: fetchPriceWithFallback turns null into the fallback or a domain error.
    reportError(`preisabruf:${q.name} ${condition}`, e);
    return null;
  }
}

/** "No price" is an answer (no_price); if every fetch fails without a fresh answer in the
 * cache, that is an error, so that the wishlist shows "not loaded" instead of "none". */
async function fetchPriceWithFallback(
  k: FinancesContext,
  q: PriceSource,
  condition: string,
  ttl: number,
): Promise<PriceData> {
  const other = condition === 'N' ? 'U' : 'N';
  const z = await q.lies(condition);
  if (hatPrice(z)) return fromRow(z!);
  const knownEmpty = cacheUsable(z, ttl, k.uhr.jetzt());
  let pd: CacheRow | null = null;
  if (!knownEmpty) {
    if (!(await k.externalSources.quotaFree('bricklink')).allowed) failDomain('zu_viele', 'bricklink_tageslimit');
    pd = await fetchCached(q, condition);
    if (hatPrice(pd)) return fromRow(pd!, { from_cache: false, condition_used: condition });
  }
  const zf = await q.lies(other);
  if (hatPrice(zf)) return fromRow(zf!, { condition_used: other, is_fallback: true });
  if (knownEmpty && cacheUsable(zf, ttl, k.uhr.jetzt())) return { ...WITHOUT_PRICE, from_cache: true, no_price: true };
  const free = (await k.externalSources.quotaFree('bricklink')).allowed;
  const pd2 = free ? await fetchCached(q, other) : null;
  if (hatPrice(pd2)) return fromRow(pd2!, { from_cache: false, condition_used: other, is_fallback: true });
  if (knownEmpty || pd || pd2) return { ...WITHOUT_PRICE, from_cache: !pd && !pd2, no_price: true };
  return free ? failDomain('nicht_gefunden', 'kein_bricklink_preis') : failDomain('zu_viele', 'bricklink_tageslimit');
}

/** On capture a failed fetch means "none"; the exhausted quota stays an error. */
export async function priceOrNone(fetch: Promise<PriceData>): Promise<PriceData | null> {
  try {
    return await fetch;
  } catch (e) {
    if (e instanceof DomainError && e.code === 'kein_bricklink_preis') return null;
    throw e;
  }
}

const hours = (ttlHours: Hours) => Math.max(1, parseInt(String(ttlHours), 10));

export async function fetchPrice(
  k: FinancesContext,
  setNumber: string,
  condition: string,
  guideType: string,
  currency: string,
  ttlHours: Hours,
  pre: { catalog: Map<string, CatalogEntry>; cache: Map<string, SetPreiszeile> } | null = null,
): Promise<PriceData> {
  // withVersion() on the preloaded path too: the map comes from catalog_cache,
  // i.e. under the same spelling as the table.
  const catalogRow = pre?.catalog
    ? pre.catalog.get(withVersion(setNumber)) || null
    : await k.catalog.catalogEntry(setNumber);
  if (withoutBricklinkPrice(catalogRow))
    return { ...WITHOUT_PRICE, from_cache: true, no_price: true, bl_unbekannt: true };
  const ttl = hours(ttlHours);
  const source: PriceSource = {
    name: `Price ${setNumber}`,
    lies: c =>
      pre?.cache ? pre.cache.get(`${setNumber}|${c}`) || null : priceFromCache(k, setNumber, c, currency, ttl),
    ask: c => k.catalog.priceGuide(setNumber, c, guideType, currency),
    remember: async (c, g) => {
      const p = await savePrice(k, setNumber, c, currency, g);
      console.log(`  Price ${setNumber} cond=${c}: avg=${p.avg} qty_avg=${p.qavg}`);
      return { min_price: p.min, avg_price: p.avg, max_price: p.max, qty_avg_price: p.qavg };
    },
  };
  return fetchPriceWithFallback(k, source, condition, ttl);
}

/** Only the cache: a list should not wait for BrickLink. Fallback to the other
 * condition; if both are freshly empty there is no price, if one is missing it is pending. */
export function priceFromStock(
  lies: (condition: 'N' | 'U') => CacheRow | null | undefined,
  condition: 'N' | 'U',
  ttlHours: number,
  now: number,
): PriceData {
  const other = condition === 'N' ? 'U' : 'N';
  const z = lies(condition) ?? null;
  if (hatPrice(z)) return fromRow(z!);
  const zf = lies(other) ?? null;
  if (hatPrice(zf)) return fromRow(zf!, { condition_used: other, is_fallback: true });
  if (cacheUsable(z, ttlHours, now) && cacheUsable(zf, ttlHours, now))
    return { ...WITHOUT_PRICE, from_cache: true, no_price: true };
  return { ...WITHOUT_PRICE, from_cache: false, ausstehend: true };
}

export function setPriceFromStock(
  setNumber: string,
  condition: 'N' | 'U',
  ttlHours: number,
  now: number,
  pre: { catalog: Map<string, unknown>; cache: Map<string, CacheRow> },
): PriceData {
  if (
    withoutBricklinkPrice(
      (pre.catalog.get(withVersion(setNumber)) as Parameters<typeof withoutBricklinkPrice>[0]) ?? null,
    )
  )
    return { ...WITHOUT_PRICE, from_cache: true, no_price: true, bl_unbekannt: true };
  return priceFromStock(c => pre.cache.get(`${setNumber}|${c}`), condition, ttlHours, now);
}

export async function partKey(k: FinancesContext, partNumber: string, rbColorId: number): Promise<string> {
  return `${await resolveBlPartNumber(k, partNumber)}|${Number(await resolveBlColorId(k, rbColorId)) || 0}`;
}

export async function parallelLimit<T>(tasks: (() => Promise<T>)[], limit: number) {
  const results = new Array(tasks.length);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      const t = tasks[i];
      if (t) results[i] = await t();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

// Memory for two translation tables that do not change during
// a valuation; per part the query would otherwise cost most of the time.
const SUPPLEMENT_TTL_MS = 10 * 60 * 1000;
// When exceeded it is cleared instead of evicted one by one: a handful of
// users, small tables (like _tokenCache in src/account/tokenCache.ts).
const SUPPLEMENT_MAX = 5000;

/** A `null` (nothing found) is not remembered. */
function lookupTable<S, W>(clock: Clock, hole: (key: S) => Promise<W | null>) {
  const karte = new Map<S, { wert: W; zeit: number }>();
  const ask = async (key: S): Promise<W | null> => {
    const now = clock.jetzt();
    const hits = karte.get(key);
    if (hits && now - hits.zeit < SUPPLEMENT_TTL_MS) return hits.wert;
    const wert = await hole(key);
    if (wert == null) {
      karte.delete(key);
      return null;
    }
    if (karte.size >= SUPPLEMENT_MAX) karte.clear();
    karte.set(key, { wert, zeit: now });
    return wert;
  };
  // No clearing: the source tables are only extended, a hit stays correct.
  ask.kennt = (key: S) => {
    const hits = karte.get(key);
    return !!hits && clock.jetzt() - hits.zeit < SUPPLEMENT_TTL_MS;
  };
  ask.merken = (key: S, wert: W) => {
    if (karte.size >= SUPPLEMENT_MAX) karte.clear();
    karte.set(key, { wert, zeit: clock.jetzt() });
  };
  return ask;
}

/** The whole table (about 200 rows), loaded once per access and shared: per key
 * every unknown color would remain a query of its own, parallel valuators would each load it themselves. */
type ColorState = { karte: Map<number, number> | null; zeit: number; load: Promise<Map<number, number>> | null };
export async function colorChart(k: FinancesContext): Promise<Map<number, number>> {
  const st = k.faecher.slot<ColorState>('farbkarte', () => ({ karte: null, zeit: 0, load: null }));
  const now = k.uhr.jetzt();
  if (st.karte && now - st.zeit < SUPPLEMENT_TTL_MS) return st.karte;
  if (st.load) return st.load;
  st.load = (async () => {
    const rows = await k.preisCache.blColors();
    const karte = new Map<number, number>();
    for (const r of rows) karte.set(Number(r.id), r.bl_color_id);
    // An EMPTY table is NOT remembered: before the first reconciliation it is empty,
    // and refusing every translation for ten minutes would mean ignoring the reconciliation.
    if (karte.size) Object.assign(st, { karte, zeit: now });
    return karte;
  })();
  try {
    return await st.load;
  } finally {
    st.load = null;
  }
}

/** KEINE_FARBE is 0 at BrickLink, Rebrickable's 0 is black. @returns null if the map
 * is not readable: with the Rebrickable color the price of another part would come back. */
export async function resolveBlColorId(k: FinancesContext, rbColorId: number): Promise<number | null> {
  if (rbColorId == null || rbColorId === NO_COLOR) return 0;
  const karte = await attempts('preise:farbkarte', colorChart(k));
  if (!karte.ok) return null;
  const hits = karte.wert.get(Number(rbColorId));
  return hits != null ? Number(hits) : rbColorId;
}

// Without translation BrickLink answers RB numbers with 404. One source
// (bl_mapping), so that two places do not drift apart. One memory per set of services.
const blTeil = (k: FinancesContext) =>
  k.faecher.slot('blTeil', () =>
    lookupTable(k.uhr, (partNumber: string) => k.catalog.blFetchNumber('part', partNumber)),
  );

/** With `konto`, that account's own mapping first (migration 0094); it bypasses the
 * shared memory because it only applies to this account. */
export async function resolveBlPartNumber(k: FinancesContext, partNumber: string, konto: number | null = null) {
  // No catch: with the Rebrickable number the price of another part would come back.
  if (konto !== null) return (await k.catalog.blFetchNumber('part', partNumber, konto)) ?? partNumber;
  return (await blTeil(k)(partNumber)) ?? partNumber;
}

/** In two queries, because the memory does not help within a valuation:
 * every part has a different number. */
export async function loadBlNumbersBefore(k: FinancesContext, partNumbers: string[]): Promise<void> {
  const open = [...new Set(partNumbers.filter(Boolean).map(String))].filter(n => !blTeil(k).kennt(n));
  if (!open.length) return;
  // The query lives in src/catalog/blMapping.ts.
  for (const [rb, bl] of await k.catalog.blFetchNumbers('part', open)) blTeil(k).merken(rb, bl);
}

/** Otherwise every part would ask per condition individually. Keys as in fetchPartPrice:
 * BrickLink number|BrickLink color|condition. */
export async function preloadPartPrices(
  k: FinancesContext,
  parts: { partNumber: string; rbColorId: number }[],
  currency: string,
  ttlHours: Hours,
): Promise<Map<string, Preiszeile>> {
  const ttl = Math.max(1, parseInt(String(ttlHours), 10));
  const numbers: string[] = [],
    colors: number[] = [];
  for (const t of parts) {
    const color = await resolveBlColorId(k, t.rbColorId);
    if (color === null) continue;
    numbers.push(await resolveBlPartNumber(k, t.partNumber));
    colors.push(color);
  }
  const stock = new Map<string, Preiszeile>();
  if (!numbers.length) return stock;
  const rows = await k.preisCache.partsPricesFresh(numbers, colors, currency, ttl);
  for (const z of rows) stock.set(`${z.part_number}|${z.color_id}|${z.condition}`, z);
  return stock;
}

/** Like ladeTeilepreiseVor, for figures — only real BrickLink prices. */
export async function preloadMinifigPrices(
  k: FinancesContext,
  minifigs: string[],
  currency: string,
  ttlHours: Hours,
): Promise<Map<string, Preiszeile>> {
  const ttl = Math.max(1, parseInt(String(ttlHours), 10));
  const stock = new Map<string, Preiszeile>();
  if (!minifigs.length) return stock;
  const rows = await k.preisCache.minifigsPricesFresh([...new Set(minifigs)], currency, ttl);
  for (const z of rows) stock.set(`${z.fig_number}|${z.condition}`, z);
  return stock;
}

/** Sales first, otherwise offers: for parts in rare colors "no sale
 * in six months" is the normal case. */
async function questionPriceGuide(
  k: FinancesContext,
  path: string,
  condition: string,
  currency: string,
  extra: Record<string, string> = {},
) {
  const qp = { guide_type: 'sold', new_or_used: condition, currency_code: currency, vat: 'N', ...extra };
  const g = await k.externalSources.quellen.bricklinkRequest('GET', path, qp);
  if (hatPrice(g)) return g;
  const alt = await attempts(
    'preise:alt',
    k.externalSources.quellen.bricklinkRequest('GET', path, { ...qp, guide_type: 'stock' }),
  );
  return alt.ok && hatPrice(alt.wert) ? alt.wert : g;
}

type Writer = (avg: number, qavg: number) => Promise<unknown>;

/** A zero is remembered as well (holds back the fetch); a zero point in the history would look like a price crash. */
async function rememberWithHistory(g: PriceFuehrer | null | undefined, ort: string, cache: Writer, history: Writer) {
  const row = { avg_price: numberFrom(g?.avg_price), qty_avg_price: numberFrom(g?.qty_avg_price) };
  await cache(row.avg_price, row.qty_avg_price);
  if (hatPrice(row)) await history(row.avg_price, row.qty_avg_price).catch(logAndContinue(ort));
  return row;
}

/** Number and color translated for cache, fetch and writing, otherwise they would not match each other.
 * @param stock from ladeTeilepreiseVor; if a key is missing, there is no fresh entry. */
export async function fetchPartPrice(
  k: FinancesContext,
  partNumber: string,
  rbColorId: number,
  condition: string,
  currency: string,
  ttlHours: Hours,
  stock: Map<string, Preiszeile> | null = null,
  konto: number | null = null,
): Promise<PriceData> {
  const color = await resolveBlColorId(k, rbColorId);
  if (color === null) failDomain('nicht_gefunden', 'kein_bricklink_preis');
  const number = await resolveBlPartNumber(k, partNumber, konto);
  const f = Number(color) || 0;
  const ttl = hours(ttlHours);
  const cache = k.preisCache;
  const source: PriceSource = {
    name: `Part price ${partNumber}${number !== partNumber ? ` (bl ${number})` : ''} color ${color} (rb color ${rbColorId})`,
    lies: c => (stock ? (stock.get(`${number}|${f}|${c}`) ?? null) : cache.partPriceFresh(number, f, c, currency, ttl)),
    ask: c =>
      questionPriceGuide(k, `/items/part/${number}/price`, c, currency, color ? { color_id: String(color) } : {}),
    remember: (c, g) =>
      rememberWithHistory(
        g,
        'preise:teileverlauf schreiben',
        (avg, qavg) => cache.rememberPartPrice(number, f, c, currency, avg, qavg),
        (avg, qavg) => cache.rememberPartHistory(number, f, c, currency, avg, qavg),
      ),
  };
  return fetchPriceWithFallback(k, source, condition, ttl);
}

/** Like fetchPartPrice; only real BrickLink prices are read, no estimates.
 * @param stock from ladeFigurenpreiseVor; if a key is missing, there is no fresh entry. */
export async function fetchMinifigPrice(
  k: FinancesContext,
  figNumber: string,
  condition: string,
  currency: string,
  ttlHours: Hours,
  stock: Map<string, Preiszeile> | null = null,
): Promise<PriceData> {
  const ttl = hours(ttlHours);
  const cache = k.preisCache;
  const source: PriceSource = {
    name: `Minifig price ${figNumber}`,
    lies: c =>
      stock ? (stock.get(`${figNumber}|${c}`) ?? null) : cache.minifigPriceFresh(figNumber, c, currency, ttl),
    ask: c => questionPriceGuide(k, `/items/minifig/${figNumber}/price`, c, currency),
    remember: (c, g) =>
      rememberWithHistory(
        g,
        'preise:figurverlauf schreiben',
        (avg, qavg) => cache.rememberMinifigPrice(figNumber, c, currency, avg, qavg),
        (avg, qavg) => cache.rememberMinifigHistory(figNumber, c, currency, avg, qavg),
      ),
  };
  return fetchPriceWithFallback(k, source, condition, ttl);
}
