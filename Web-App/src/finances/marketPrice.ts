import { getSetValue } from './setValue';
import { fetchPriceForSet } from './priceRun';
import {
  DEFAULT_PRICE_CONDITION,
  fetchPartPrice,
  fetchMinifigPrice,
  loadBlNumbersBefore,
  priceOrNone,
  resolveBlPartNumber,
  resolveBlColorId,
} from './calculation/prices';
import { reportError, logAndContinue } from '../infra/error';
import { marketPriceFrom } from '../catalog';
import { NO_COLOR, conditionOf } from '../infra/validate';
import type { FinancesContext } from './context';

// A leaf without back references, so that callers import properly instead of late with require().
export async function currentMarketPrice(
  k: FinancesContext,
  setNumber: string,
  userId: number,
  condition: string | null = null,
) {
  const currency = String(await k.settings.userValue(userId, 'currency', 'EUR'));
  // Parameter → user → global → 'N'.
  const effectiveCond = condition || (await k.settings.userDefaultCondition(userId));
  // condition as a hint: when creating, there is no acquisition yet from which
  // the price run could read the condition.
  await fetchPriceForSet(k, setNumber, userId, condition).catch(logAndContinue('marktpreis:preisFuerSetHolen'));

  // An explicitly requested condition applies exactly as is: when creating there is
  // no acquisition yet from which getSetValue() could derive it.
  if (!condition) {
    // Without an explicit wish: valuation per acquisition by its condition.
    const v = await getSetValue(k, userId, setNumber, currency);
    if (v.unit_price !== null) return v.unit_price;
  }

  // Requested condition first; the other one only if there is no price there.
  const cached = await k.marketPrices.setPriceFromCache(setNumber, effectiveCond, currency);
  return cached ? Number(cached.market_price) : null;
}

// Market prices for sets, parts and figures in one place, so that the condition rule
// does not diverge per kind.

/** 'U' as soon as one acquisition is used; without an acquisition the default. */
export async function partState(k: FinancesContext, userId: number, partNumber: string, colorId: number) {
  try {
    const row = await k.marketPrices.partEntryState(userId, partNumber, colorId);
    if (row && parseInt(row.cnt, 10) > 0) return Number(row.any_used) > 0 ? 'U' : 'N';
  } catch (e) {
    reportError('teile:zustand-ermitteln', e);
  }
  return k.settings.userDefaultCondition(userId);
}

async function cacheSettings(k: FinancesContext, viewerId: number): Promise<{ currency: string; ttl: number }> {
  const [currency, ttlRaw] = await Promise.all([
    k.settings.userValue(viewerId, 'currency', 'EUR'),
    k.settings.globalValue('price_cache_ttl', '24'),
  ]);
  return { currency: String(currency), ttl: Math.max(1, parseInt(String(ttlRaw), 10)) };
}

/** The first cached price over the keys, the requested condition before the other one. */
function firstCached(
  cache: Map<string, number>,
  keys: string[],
  condition: string | null | undefined,
): number | undefined {
  const zst = conditionOf(condition);
  for (const k of keys)
    for (const c of [zst, zst === 'N' ? 'U' : 'N']) {
      const value = cache.get(`${k}|${c}`);
      if (value != null) return value;
    }
  return undefined;
}

/** Only from the cache, without fetching: the list should not wait for BrickLink. */
export async function marketPricesFromCacheForMinifigs(
  kx: FinancesContext,
  minifigs: Array<{ fig_number?: string | null; bl_fig_number?: string | null; condition?: string | null }>,
  viewerId: number,
): Promise<Map<string, number>> {
  const hits = new Map<string, number>();
  if (!minifigs.length) return hits;
  const { currency, ttl } = await cacheSettings(kx, viewerId);

  // Both spellings: fetchMinifigPrice() stores under the BL number, the
  // estimate under the RB number.
  const spellings = (f: (typeof minifigs)[number]) => [f.bl_fig_number, f.fig_number].filter(Boolean).map(String);
  const key = [...new Set(minifigs.flatMap(spellings))];
  if (!key.length) return hits;

  // No catch: the list treats the error as `degradiert` (reduced) and shows them without a price.
  const rows = await kx.marketPrices.minifigsPricesFromCache(key, currency, ttl);

  const cache = new Map<string, number>();
  for (const z of rows) {
    const value = marketPriceFrom(z);
    if (value !== null) cache.set(`${z.fig_number}|${z.condition}`, value);
  }

  for (const f of minifigs) {
    const num = String(f.fig_number ?? '');
    if (!num) continue;
    // Order as in the valuation; for many older figures BrickLink lists
    // only one of the two conditions. A price under the RB number wins over the BL number.
    const value = firstCached(cache, spellings(f).reverse(), f.condition);
    if (value !== undefined) hits.set(num, value);
  }
  return hits;
}

type CachePart = {
  part_number?: string | null;
  bl_part_number?: string | null;
  color_id?: number | null;
  condition?: string | null;
};

/** The keys under which fetchPartPrice would have written. */
async function partCacheKeys(k: FinancesContext, parts: CachePart[]) {
  const resolution = new Map<string, { number: string; color: number }>();
  for (const t of parts) {
    const raw = String(t.bl_part_number || t.part_number || '');
    if (!raw) continue;
    const key = `${t.part_number}|${t.color_id ?? NO_COLOR}`;
    if (resolution.has(key)) continue;
    resolution.set(key, {
      number: await resolveBlPartNumber(k, raw),
      color: Number(await resolveBlColorId(k, Number(t.color_id ?? NO_COLOR))) || 0,
    });
  }
  return resolution;
}

// The parts cache is keyed by BrickLink number and color; both are translated beforehand.
export async function marketPricesFromCacheForParts(
  k: FinancesContext,
  parts: CachePart[],
  viewerId: number,
): Promise<Map<string, number>> {
  const hits = new Map<string, number>();
  if (!parts.length) return hits;
  const { currency, ttl } = await cacheSettings(k, viewerId);

  await loadBlNumbersBefore(
    k,
    parts.map(t => String(t.bl_part_number || t.part_number || '')),
  );
  const resolution = await partCacheKeys(k, parts);

  const numbers = [...new Set([...resolution.values()].map(a => a.number))];
  if (!numbers.length) return hits;
  const rows = await k.marketPrices.partsPricesFromCache(numbers, currency, ttl);

  const cache = new Map<string, number>();
  for (const z of rows) {
    const value = marketPriceFrom(z);
    if (value !== null) cache.set(`${z.part_number}|${z.color_id}|${z.condition}`, value);
  }

  for (const t of parts) {
    const key = `${t.part_number}|${t.color_id ?? NO_COLOR}`;
    const a = resolution.get(key);
    if (!a) continue;
    const value = firstCached(cache, [`${a.number}|${a.color}`], t.condition);
    if (value !== undefined) hits.set(key, value);
  }
  return hits;
}

/** With origin for the one place that shows it; all others take the number. */
export async function marketPriceWithOrigin(
  k: FinancesContext,
  partNumber: string,
  colorId: number,
  userId: number,
  condition: string | null = null,
) {
  const currency = await k.settings.userValue(userId, 'currency', 'EUR');
  const ttlHours = (await k.settings.globalValue('price_cache_ttl', '24')) || '24';
  const effCond = condition || (await partState(k, userId, partNumber, colorId));
  const priceData = await priceOrNone(
    fetchPartPrice(k, partNumber, colorId, effCond, currency, ttlHours, null, userId),
  );
  const price = marketPriceFrom(priceData);
  if (price === null) return { price: null, fromState: null };
  // The fallback to the other condition is adopted, but named: no price
  // at all was worse than a marked one.
  return {
    price: price,
    fromState: priceData?.is_fallback ? priceData.condition_used || null : null,
  };
}

export async function currentPartMarketPrice(
  k: FinancesContext,
  partNumber: string,
  colorId: number,
  userId: number,
  condition: string | null = null,
) {
  return (await marketPriceWithOrigin(k, partNumber, colorId, userId, condition)).price;
}

export async function estimateFigPriceFromParts(
  k: FinancesContext,
  figNumber: string,
  userId: number,
  condition = DEFAULT_PRICE_CONDITION,
) {
  return (await estimateMinifigsPrice(k, figNumber, userId, condition))?.price ?? null;
}

/** The coverage (share of parts with a price) says how reliable the number is. */
export async function estimateMinifigsPrice(
  k: FinancesContext,
  figNumber: string,
  userId: number,
  condition = DEFAULT_PRICE_CONDITION,
): Promise<{ price: number; abdeckung: number | null } | null> {
  try {
    const currency = await k.settings.userValue(userId, 'currency', 'EUR');
    const cond0 = conditionOf(condition, DEFAULT_PRICE_CONDITION);

    // Look in the cache first: otherwise every figure would cost one fetch per part.
    const ttl = Math.max(1, parseInt(await k.settings.globalValue('price_cache_ttl', '24'), 10));
    const cached = await k.marketPrices.estimatedMinifigsPrice(figNumber, cond0, currency, ttl);
    const cachedPrice = Number(cached?.market_price) || 0;
    if (cachedPrice > 0)
      return {
        price: cachedPrice,
        abdeckung: cached?.coverage != null ? parseFloat(String(cached.coverage)) : null,
      };

    const parts = await k.catalog.minifigParts(figNumber);
    if (!parts.length) {
      console.log(`[minifig-price-estimate] ${figNumber}: keine Teile-Zusammensetzung von Rebrickable erhalten`);
      return null;
    }

    // In ONE query instead of per part.
    await loadBlNumbersBefore(
      k,
      parts.filter((p: { bl_part_num?: string | null }) => !p.bl_part_num).map((p: { part_num: string }) => p.part_num),
    );

    const cond = cond0;

    let total = 0,
      priced = 0;
    for (const p of parts) {
      // Otherwise fetchPartPrice translates itself and finds the answer in the just
      // filled memory.
      const blPartNum = p.bl_part_num || p.part_num;
      try {
        const priceData = await priceOrNone(fetchPartPrice(k, blPartNum, p.color_id ?? NO_COLOR, cond, currency, 24));
        const unitPrice = marketPriceFrom(priceData);
        if (unitPrice !== null) {
          total += unitPrice * (p.quantity || 1);
          priced++;
        }
      } catch (e) {
        reportError('marktpreis:teil-in-figur', e);
      }
    }
    console.log(
      `[minifig-price-estimate] ${figNumber} (${cond}): ${priced}/${parts.length} Teile bepreist, geschätzt=${priced > 0 ? total.toFixed(2) : '—'}`,
    );
    if (priced === 0) return null;

    // In cache and history, marked as estimated: fetchMinifigPrice only reads
    // unmarked rows, the display labels them.
    const abdeckung = Math.round((priced / parts.length) * 1000) / 1000;
    // Together, as for sets (savePrice): a cache without a history point would hold back
    // the next estimate. An error ends below as a message without an estimate.
    await k.transact(async t => {
      await t.marketPrices.rememberEstimatedMinifigsPrice(figNumber, cond, currency, total, abdeckung);
      await t.marketPrices.rememberEstimatedMinifigsHistory(figNumber, cond, currency, total, abdeckung);
    });

    return { price: total, abdeckung };
  } catch (e) {
    // Exception: the estimate is an addition to the market price; without it "no price" is shown.
    reportError(`figurenpreis-schaetzung:${figNumber}`, e);
    return null;
  }
}

/** One "used" acquisition is enough for 'U'; without an acquisition the default. */
async function minifigCondition(k: FinancesContext, userId: number, figNumber: string): Promise<string> {
  try {
    const row = await k.marketPrices.minifigEntryState(userId, figNumber);
    if (row && parseInt(row.cnt, 10) > 0) return Number(row.any_used) > 0 ? 'U' : 'N';
  } catch (e) {
    reportError('minifiguren:zustand-ermitteln', e);
  }
  return k.settings.userDefaultCondition(userId);
}

export async function figMarketPriceWithOrigin(
  k: FinancesContext,
  figNumber: string,
  userId: number,
  blFigNumber?: string | null,
  condition: string | null = null,
) {
  const currency = await k.settings.userValue(userId, 'currency', 'EUR');
  const effCond = condition || (await minifigCondition(k, userId, figNumber));
  // BrickLink first, even without an own bl_fig_number: usually the own
  // number matches the BrickLink number.
  for (const num of [blFigNumber, figNumber]) {
    if (!num) continue;
    const priceData = await priceOrNone(fetchMinifigPrice(k, num, effCond, currency, 24));
    // The fallback is adopted, but named — as for the parts.
    const price = marketPriceFrom(priceData);
    if (price !== null)
      return {
        price: price,
        fromState: priceData?.is_fallback ? priceData.condition_used || null : null,
        estimated: false,
      };
    if (num === blFigNumber && blFigNumber === figNumber) break; // do not ask twice
  }
  // Without an origin: the estimate does not come from the other condition.
  const estimate = await estimateMinifigsPrice(k, figNumber, userId, effCond);
  return {
    price: estimate?.price ?? null,
    fromState: null,
    estimated: estimate != null,
    abdeckung: estimate?.abdeckung ?? null,
  };
}

export async function currentMinifigMarketPrice(
  k: FinancesContext,
  figNumber: string,
  userId: number,
  blFigNumber?: string | null,
  condition: string | null = null,
) {
  return (await figMarketPriceWithOrigin(k, figNumber, userId, blFigNumber, condition)).price;
}
