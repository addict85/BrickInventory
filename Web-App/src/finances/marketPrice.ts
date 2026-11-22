import { getSetValue } from './setValue';
import { preisFuerSetHolen } from './priceRun';
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
import { KEINE_FARBE, zustand } from '../infra/validate';
import type { FinancesContext } from './context';

// A leaf without back references, so that callers import properly instead of late with require().
export async function aktuellerMarktpreis(
  k: FinancesContext,
  setNumber: string,
  userId: number,
  condition: string | null = null,
) {
  const currency = String(await k.einstellungen.userValue(userId, 'currency', 'EUR'));
  // Parameter → user → global → 'N'.
  const effectiveCond = condition || (await k.einstellungen.userDefaultCondition(userId));
  // condition as a hint: when creating, there is no acquisition yet from which
  // the price run could read the condition.
  await preisFuerSetHolen(k, setNumber, userId, condition).catch(logAndContinue('marktpreis:preisFuerSetHolen'));

  // An explicitly requested condition applies exactly as is: when creating there is
  // no acquisition yet from which getSetValue() could derive it.
  if (!condition) {
    // Without an explicit wish: valuation per acquisition by its condition.
    const v = await getSetValue(k, userId, setNumber, currency);
    if (v.unit_price !== null) return v.unit_price;
  }

  // Requested condition first; the other one only if there is no price there.
  const cached = await k.marktpreise.setPriceFromCache(setNumber, effectiveCond, currency);
  return cached ? Number(cached.marktpreis) : null;
}

// Market prices for sets, parts and figures in one place, so that the condition rule
// does not diverge per kind.

/** 'U' as soon as one acquisition is used; without an acquisition the default. */
export async function partState(k: FinancesContext, userId: number, partNumber: string, colorId: number) {
  try {
    const row = await k.marktpreise.partEntryState(userId, partNumber, colorId);
    if (row && parseInt(row.cnt, 10) > 0) return Number(row.any_used) > 0 ? 'U' : 'N';
  } catch (e) {
    reportError('teile:zustand-ermitteln', e);
  }
  return k.einstellungen.userDefaultCondition(userId);
}

/** Only from the cache, without fetching: the list should not wait for BrickLink. */
export async function marketPricesFromCacheForMinifigs(
  kx: FinancesContext,
  figuren: Array<{ fig_number?: string | null; bl_fig_number?: string | null; condition?: string | null }>,
  viewerId: number,
): Promise<Map<string, number>> {
  const treffer = new Map<string, number>();
  if (!figuren.length) return treffer;

  const [currency, ttlRaw] = await Promise.all([
    kx.einstellungen.userValue(viewerId, 'currency', 'EUR'),
    kx.einstellungen.globalValue('price_cache_ttl', '24'),
  ]);
  const ttl = Math.max(1, parseInt(String(ttlRaw), 10));

  // Both spellings: fetchMinifigPrice() stores under the BL number, the
  // estimate under the RB number.
  const schluessel = [...new Set(figuren.flatMap(f => [f.bl_fig_number, f.fig_number].filter(Boolean).map(String)))];
  if (!schluessel.length) return treffer;

  // No catch: the list treats the error as `degradiert` (reduced) and shows them without a price.
  const zeilen = await kx.marktpreise.minifigsPricesFromCache(schluessel, String(currency), ttl);

  const cache = new Map<string, number>();
  for (const z of zeilen) {
    const wert = marketPriceFrom(z);
    if (wert !== null) cache.set(`${z.fig_number}|${z.condition}`, wert);
  }

  for (const f of figuren) {
    const nummer = String(f.fig_number ?? '');
    if (!nummer) continue;
    const zst = zustand(f.condition);
    const anders = zst === 'N' ? 'U' : 'N';
    // Order as in the valuation; for many older figures BrickLink lists
    // only one of the two conditions.
    for (const k of [f.bl_fig_number, f.fig_number].filter(Boolean).map(String))
      for (const c of [zst, anders]) {
        const wert = cache.get(`${k}|${c}`);
        if (wert != null) {
          treffer.set(nummer, wert);
          break;
        }
      }
    if (treffer.has(nummer)) continue;
  }
  return treffer;
}

// The parts cache is keyed by BrickLink number and color; both are translated beforehand.
export async function marketPricesFromCacheForParts(
  k: FinancesContext,
  teile: Array<{
    part_number?: string | null;
    bl_part_number?: string | null;
    color_id?: number | null;
    condition?: string | null;
  }>,
  viewerId: number,
): Promise<Map<string, number>> {
  const treffer = new Map<string, number>();
  if (!teile.length) return treffer;

  const [currency, ttlRaw] = await Promise.all([
    k.einstellungen.userValue(viewerId, 'currency', 'EUR'),
    k.einstellungen.globalValue('price_cache_ttl', '24'),
  ]);
  const ttl = Math.max(1, parseInt(String(ttlRaw), 10));

  await loadBlNumbersBefore(
    k,
    teile.map(t => String(t.bl_part_number || t.part_number || '')),
  );

  // The keys under which fetchPartPrice would have written.
  const resolution = new Map<string, { nummer: string; farbe: number }>();
  for (const t of teile) {
    const roh = String(t.bl_part_number || t.part_number || '');
    if (!roh) continue;
    const schluessel = `${t.part_number}|${t.color_id ?? KEINE_FARBE}`;
    if (resolution.has(schluessel)) continue;
    resolution.set(schluessel, {
      nummer: await resolveBlPartNumber(k, roh),
      farbe: Number(await resolveBlColorId(k, Number(t.color_id ?? KEINE_FARBE))) || 0,
    });
  }

  const nummern = [...new Set([...resolution.values()].map(a => a.nummer))];
  if (!nummern.length) return treffer;
  const zeilen = await k.marktpreise.partsPricesFromCache(nummern, String(currency), ttl);

  const cache = new Map<string, number>();
  for (const z of zeilen) {
    const wert = marketPriceFrom(z);
    if (wert !== null) cache.set(`${z.part_number}|${z.color_id}|${z.condition}`, wert);
  }

  for (const t of teile) {
    const schluessel = `${t.part_number}|${t.color_id ?? KEINE_FARBE}`;
    const a = resolution.get(schluessel);
    if (!a) continue;
    const zst = zustand(t.condition);
    for (const c of [zst, zst === 'N' ? 'U' : 'N']) {
      const wert = cache.get(`${a.nummer}|${a.farbe}|${c}`);
      if (wert != null) {
        treffer.set(schluessel, wert);
        break;
      }
    }
  }
  return treffer;
}

/** With origin for the one place that shows it; all others take the number. */
export async function marketPriceWithOrigin(
  k: FinancesContext,
  partNumber: string,
  colorId: number,
  userId: number,
  condition: string | null = null,
) {
  const currency = await k.einstellungen.userValue(userId, 'currency', 'EUR');
  const ttlHours = (await k.einstellungen.globalValue('price_cache_ttl', '24')) || '24';
  const effCond = condition || (await partState(k, userId, partNumber, colorId));
  const priceData = await priceOrNone(
    fetchPartPrice(k, partNumber, colorId, effCond, currency, ttlHours, null, userId),
  );
  const price = marketPriceFrom(priceData);
  if (price === null) return { preis: null, fromState: null };
  // The fallback to the other condition is adopted, but named: no price
  // at all was worse than a marked one.
  return {
    preis: price,
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
  return (await marketPriceWithOrigin(k, partNumber, colorId, userId, condition)).preis;
}

export async function estimateFigPriceFromParts(
  k: FinancesContext,
  figNumber: string,
  userId: number,
  condition = DEFAULT_PRICE_CONDITION,
) {
  return (await estimateMinifigsPrice(k, figNumber, userId, condition))?.preis ?? null;
}

/** The coverage (share of parts with a price) says how reliable the number is. */
export async function estimateMinifigsPrice(
  k: FinancesContext,
  figNumber: string,
  userId: number,
  condition = DEFAULT_PRICE_CONDITION,
): Promise<{ preis: number; abdeckung: number | null } | null> {
  try {
    const currency = await k.einstellungen.userValue(userId, 'currency', 'EUR');
    const cond0 = zustand(condition, DEFAULT_PRICE_CONDITION);

    // Look in the cache first: otherwise every figure would cost one fetch per part.
    const ttl = Math.max(1, parseInt(await k.einstellungen.globalValue('price_cache_ttl', '24'), 10));
    const cached = await k.marktpreise.estimatedMinifigsPrice(figNumber, cond0, currency, ttl);
    const zwischengespeichert = Number(cached?.marktpreis) || 0;
    if (zwischengespeichert > 0)
      return {
        preis: zwischengespeichert,
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
        const priceData = await priceOrNone(
          fetchPartPrice(k, blPartNum, p.color_id ?? KEINE_FARBE, cond, currency, 24),
        );
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
    await k.transaktion(async t => {
      await t.marktpreise.rememberEstimatedMinifigsPrice(figNumber, cond, currency, total, abdeckung);
      await t.marktpreise.rememberEstimatedMinifigsHistory(figNumber, cond, currency, total, abdeckung);
    });

    return { preis: total, abdeckung };
  } catch (e) {
    // Exception: the estimate is an addition to the market price; without it "no price" is shown.
    reportError(`figurenpreis-schaetzung:${figNumber}`, e);
    return null;
  }
}

export async function figMarketPriceWithOrigin(
  k: FinancesContext,
  figNumber: string,
  userId: number,
  blFigNumber?: string | null,
  condition: string | null = null,
) {
  const currency = await k.einstellungen.userValue(userId, 'currency', 'EUR');
  // One "used" acquisition is enough for 'U'; without an acquisition the default.
  let effCond = condition;
  if (!effCond) {
    try {
      const row = await k.marktpreise.minifigEntryState(userId, figNumber);
      if (row && parseInt(row.cnt, 10) > 0) effCond = Number(row.any_used) > 0 ? 'U' : 'N';
    } catch (e) {
      reportError('minifiguren:zustand-ermitteln', e);
    }
    if (!effCond) effCond = await k.einstellungen.userDefaultCondition(userId);
  }
  // BrickLink first, even without an own bl_fig_number: usually the own
  // number matches the BrickLink number.
  for (const num of [blFigNumber, figNumber]) {
    if (!num) continue;
    const priceData = await priceOrNone(fetchMinifigPrice(k, num, effCond, currency, 24));
    // The fallback is adopted, but named — as for the parts.
    const price = marketPriceFrom(priceData);
    if (price !== null)
      return {
        preis: price,
        fromState: priceData?.is_fallback ? priceData.condition_used || null : null,
        geschaetzt: false,
      };
    if (num === blFigNumber && blFigNumber === figNumber) break; // do not ask twice
  }
  // Without an origin: the estimate does not come from the other condition.
  const schaetzung = await estimateMinifigsPrice(k, figNumber, userId, effCond);
  return {
    preis: schaetzung?.preis ?? null,
    fromState: null,
    geschaetzt: schaetzung != null,
    abdeckung: schaetzung?.abdeckung ?? null,
  };
}

export async function currentMinifigMarketPrice(
  k: FinancesContext,
  figNumber: string,
  userId: number,
  blFigNumber?: string | null,
  condition: string | null = null,
) {
  return (await figMarketPriceWithOrigin(k, figNumber, userId, blFigNumber, condition)).preis;
}
