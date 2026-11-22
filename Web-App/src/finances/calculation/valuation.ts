/** What the inventory is worth today; stands on the price layer (prices.ts) and
 * carries the profit calculation, not the other way round. Only the price cache is read:
 * missing prices are fetched by the job "preise_nachladen", not by the request. */

import { logAndContinue } from '../../infra/error';
import type * as repo from '../repository/valuation';
import { asIds, type Sicht } from '../../household';
import { hatPrice, marketPriceFrom } from '../../catalog';
import { resolveImageLocal, proxyImageUrl } from '../../images';
import { valueSet, valueAcquisitionRows, weightedPurchase, pnlPct as calcPnlPct, pnlProzent } from '../setValue';
import { withVersion } from '../../infra/setNumber';
import {
  DEFAULT_PRICE_CONDITION,
  parallelLimit,
  loadBlNumbersBefore,
  preloadPartPrices,
  preloadMinifigPrices,
  priceFromStock,
  setPriceFromStock,
  partKey,
  type Blickfeld,
  type PriceData,
} from './prices';
import { countFlagged } from './queries';
import type { loadSetEntries } from '../repository/acquisitions';
import { NO_COLOR, zustand } from '../../infra/validate';
import { aufRappen, inTenThousandths } from '../../infra/money';
import type { Payload } from '../../jobQueue';
import { PRICE_ITEM_AT_MOST, rememberPricesBefore } from '../priceItems';
import { errorText } from '../../infra/errorTexts';
import type { FinancesContext } from '../context';

type ConditionState = 'N' | 'U';
type Item = Payload<'preise_nachladen'>['posten'][number];
type MinifigPrice = PriceData & { estimated_from_parts?: true; abdeckung?: number | null };

/** @returns Map key → acquisition rows; key is `konto|nummer|farbe` or `konto|nummer` */
async function loadManualAcquisitions(k: FinancesContext, uid: Blickfeld, kind: 'part' | 'fig', waehrung: string) {
  // A main account values the whole household; the currency is forced to be
  // the same when linking, otherwise this would sum two currencies.
  const rows = await k.valuation.manualEntries(kind, asIds(uid), waehrung);
  const out = new Map<string, repo.ManualEntry[]>();
  for (const r of rows) {
    const key =
      kind === 'part' ? `${r.user_id}|${r.part_number}|${r.color_id ?? NO_COLOR}` : `${r.user_id}|${r.fig_number}`;
    const list = out.get(key);
    if (list) list.push(r);
    else out.set(key, [r]);
  }
  return out;
}

function foreignPurchasePrices(jeEntry: Map<string, Array<{ kaufpreis_fremd?: boolean }>>): number {
  let n = 0;
  for (const rows of jeEntry.values()) n += rows.filter(z => z.kaufpreis_fremd).length;
  return n;
}

/** The valuation reports everything that is missing; the job per account and currency picks it up. */
async function rememberPricesForAccountBefore(
  k: FinancesContext,
  viewerId: number,
  waehrung: string,
  item: Item[],
): Promise<number> {
  if (!item.length) return 0;
  await rememberPricesBefore(k, { user_id: viewerId, waehrung, posten: item.slice(0, PRICE_ITEM_AT_MOST) }).catch(
    logAndContinue('bewertung:preise vormerken'),
  );
  return item.length;
}

type BewertungsSet = Awaited<ReturnType<typeof repo.setsToValuation>>[number];
type SetEntry = Awaited<ReturnType<typeof loadSetEntries>>[number];
/** What every row needs: the viewer's settings and the preloaded tables. */
type Bewertungslage = {
  ttl: number;
  now: number;
  pre: Parameters<typeof setPriceFromStock>[4];
  fehlt: Item[];
  withoutAccess: string | null;
};

/** One row of the valuation: per purchase price the price of ITS condition, condensed
 * in valueSet(), so that the valuation rule stays in ONE place. */
function bewerteSet(set: BewertungsSet, acqs: SetEntry[], l: Bewertungslage) {
  // Without an acquisition the set counts as new (effectiveCondition without counters).
  const fallbackCond: ConditionState = 'N';
  const needed: ConditionState[] = acqs.length ? [...new Set(acqs.map(a => zustand(a.condition)))] : [fallbackCond];
  const preise = new Map<ConditionState, PriceData>(
    needed.map(c => [c, setPriceFromStock(set.set_number, c, l.ttl, l.now, l.pre)]),
  );
  const preisMap = new Map<string, number>();
  for (const [cond, p] of preise) {
    const market = marketPriceFrom(p);
    if (market !== null) preisMap.set(`${set.set_number}|${cond}`, market);
    if (p.ausstehend) l.fehlt.push({ art: 'set', nummer: set.set_number, zustand: cond });
  }
  const valued = valueSet(set.set_number, acqs, preisMap, fallbackCond, set.quantity || 1);
  const rows = valueAcquisitionRows(set.set_number, acqs, preisMap);
  // Without an acquisition no purchase price, not 0: a 0 would look like a gift.
  const purchase = weightedPurchase(rows);
  // Min/max must match the same quantity split as the average.
  const qty = valued.quantity || 1;
  const weighted = (key: 'min_price' | 'max_price' | 'qty_avg_price') =>
    valued.by_condition
      .map(bc => (preise.get(bc.condition as ConditionState)?.[key] ?? 0) * bc.quantity)
      .reduce((a, b) => a + b, 0) / qty;
  const onePrice = needed.map(c => preise.get(c)).find(p => p && !p.ausstehend);
  const pending = needed.some(c => preise.get(c)?.ausstehend === true);
  const unitAvg = valued.unit_price ?? 0;
  const conditions = valued.by_condition.map(bc => bc.condition);
  return {
    user_id: set.user_id,
    set_number: set.set_number,
    name: set.name,
    year: set.year,
    image_local: resolveImageLocal(set.image_local),
    image_url: proxyImageUrl(set.image_url),
    added_at: set.added_at,
    quantity: qty,
    // Only for callers that expect a single value.
    condition: conditions.includes('U') ? 'U' : 'N',
    conditions,
    mixed: conditions.length > 1,
    purchase_price: purchase,
    min_price: weighted('min_price'),
    avg_price: unitAvg,
    max_price: weighted('max_price'),
    qty_avg_price: weighted('qty_avg_price'),
    // From the unrounded unit price: 120.3333 × 2 is 240.67, not 240.66.
    total_avg: aufRappen((valued.unit_z ?? 0) * qty).toFixed(2),
    wert_gesamt: aufRappen((valued.unit_z ?? 0) * qty),
    total_qty_avg: aufRappen((inTenThousandths(weighted('qty_avg_price')) ?? 0) * qty).toFixed(2),
    pnl_pct: calcPnlPct(purchase, unitAvg),
    pnl_prozent: pnlProzent(purchase, unitAvg),
    acquisitions: rows,
    from_cache: true,
    is_fallback: onePrice?.is_fallback === true,
    // A pending price is not a price yet; a check mark would mean "loaded".
    no_price: (!!onePrice || pending) && valued.unit_price == null,
    bl_unbekannt: needed.some(c => preise.get(c)?.bl_unbekannt === true),
    preis_ausstehend: pending,
    ...(pending && l.withoutAccess && valued.unit_price == null
      ? { error: l.withoutAccess, error_code: 'kein_bricklink_zugang' }
      : {}),
  };
}

/** Sums from the row values, rounded only at the end. */
function valuationSums(
  rows: Array<{ quantity: number; min_price: number; max_price: number; qty_avg_price: number; total_avg: string }>,
) {
  let zMin = 0,
    zMax = 0,
    zQtyAvg = 0,
    zAvg = 0;
  for (const r of rows) {
    const q = r.quantity || 1;
    zMin += (inTenThousandths(r.min_price) ?? 0) * q;
    zMax += (inTenThousandths(r.max_price) ?? 0) * q;
    zQtyAvg += (inTenThousandths(r.qty_avg_price) ?? 0) * q;
    zAvg += inTenThousandths(r.total_avg) ?? 0;
  }
  return {
    min: aufRappen(zMin).toFixed(2),
    avg: aufRappen(zAvg).toFixed(2),
    max: aufRappen(zMax).toFixed(2),
    qty_avg: aufRappen(zQtyAvg).toFixed(2),
  };
}

/** One implementation for session route and token API. */
export async function valueSets(kx: FinancesContext, viewerId: number, idsChoice: Sicht | Blickfeld) {
  // viewerId determines the settings, ids the calculated data: with the
  // filter "sub-accounts" the asking account is missing from ids.
  const uids = await kx.household.scopeFrom(idsChoice);
  const [currency, ttlHours, guideType] = await Promise.all([
    kx.einstellungen.userValue(viewerId, 'currency', 'EUR'),
    kx.einstellungen.userValue(viewerId, 'price_cache_ttl', '24'),
    kx.einstellungen.userValue(viewerId, 'price_guide_type', 'sold'),
  ]);
  const header = {
    currency,
    condition: DEFAULT_PRICE_CONDITION,
    guide_type: guideType,
    ttl_hours: ttlHours,
    // ttl_hours stays text for older clients.
    ttl_stunden: Number(ttlHours) || 24,
  };
  const sets = await kx.valuation.setsToValuation(uids);
  if (!sets.length)
    return {
      ...header,
      kaufpreise_fremde_waehrung: 0,
      kaufpreise_umgerechnet: 0,
      sets: [],
      preise_ausstehend: 0,
      totals: { min: '0.00', avg: '0.00', max: '0.00', qty_avg: '0.00' },
    };

  // One query each for catalog, price cache and acquisitions instead of one per set.
  const setNumbers = sets.map(s => s.set_number);
  const ttl = Math.max(1, parseInt(ttlHours, 10) || 24);
  const [catRows, cacheRows, acqRows] = await Promise.all([
    // catalog_cache lists numbers with the version suffix, price_cache under the caller's spelling.
    kx.valuation.catalogFeatures(setNumbers.map(withVersion)),
    kx.priceCache.setPricesFresh(setNumbers, currency, ttl),
    kx.acquisitions.loadSetEntries(uids, currency),
  ]);
  // Without BrickLink access the job can fetch nothing: that is then shown on the row.
  const withoutAccess = (await kx.einstellungen.globalValue('bricklink_consumer_key'))
    ? null
    : errorText(
        'kein_bricklink_zugang',
        (await kx.einstellungen.userValue(viewerId, 'language', 'de')) === 'en' ? 'en' : 'de',
      );
  const situation: Bewertungslage = {
    ttl,
    now: kx.uhr.jetzt(),
    fehlt: [],
    withoutAccess,
    pre: {
      catalog: new Map(catRows.map(r => [r.set_number, r])),
      cache: new Map(cacheRows.map(r => [`${r.set_number}|${r.condition}`, r])),
    },
  };
  // Per account and set: in the household every row is the inventory of ONE account.
  const jeAccountAndSet = new Map<string, SetEntry[]>();
  for (const a of acqRows) {
    const k = `${a.user_id}|${a.set_number}`,
      l = jeAccountAndSet.get(k);
    if (l) l.push(a);
    else jeAccountAndSet.set(k, [a]);
  }
  const results = await kx.household.attachOwners(
    uids,
    sets.map(set => bewerteSet(set, jeAccountAndSet.get(`${set.user_id}|${set.set_number}`) || [], situation)),
  );
  return {
    ...header,
    // Foreign purchase prices are missing from the sums (no rates); the number says how many there are.
    kaufpreise_fremde_waehrung: countFlagged(acqRows, 'kaufpreis_fremd'),
    kaufpreise_umgerechnet: countFlagged(acqRows, 'kaufpreis_umgerechnet'),
    sets: results,
    totals: valuationSums(results),
    preise_ausstehend: await rememberPricesForAccountBefore(kx, viewerId, currency, situation.fehlt),
  };
}

function conditionsOf(acqs: { condition?: string | null }[]): ConditionState[] {
  if (!acqs?.length) return ['N'];
  const set = new Set(acqs.map(a => zustand(a.condition)));
  return (['N', 'U'] as const).filter(c => set.has(c));
}

/** One price per occurring condition; the first one with a value carries the row's additional details. */
function pricesJeState<P extends PriceData>(key: string, conds: ConditionState[], priceOf: (c: ConditionState) => P) {
  const priceMap = new Map<string, number>();
  let priceData: P | null = null;
  for (const cond of conds) {
    const pd = priceOf(cond);
    const v = marketPriceFrom(pd);
    if (v !== null) priceMap.set(`${key}|${cond}`, v);
    if (!priceData || (!hatPrice(priceData) && v !== null)) priceData = pd;
  }
  return { priceMap, priceData };
}

function valueManual(key: string, acqs: repo.ManualEntry[], priceMap: Map<string, number>, menge: number) {
  // 'N': the fallback only applies without acquisitions, and there "new" applies.
  const valued = valueSet(key, acqs, priceMap, 'N', menge);
  const rows = valueAcquisitionRows(key, acqs, priceMap);
  const unitVal = valued.unit_price ?? 0;
  const totalQty = acqs.length ? valued.quantity : menge;
  // A purchase price only counts in the account currency; a foreign currency or "unknown"
  // as 0 would drive the P&L to tens of thousands of percent.
  const acqPurchase = acqs.length ? weightedPurchase(rows) : null;
  const hasCost = acqPurchase != null;
  const purchasePrice = acqPurchase ?? 0;
  const wert_z = (valued.unit_z ?? 0) * totalQty;
  return {
    condition: valued.by_condition.some(b => b.condition === 'U') ? 'U' : 'N',
    conditions: valued.by_condition.map(b => b.condition),
    acquisitions: rows,
    purchase_price: hasCost ? purchasePrice : null,
    pnl_pct: hasCost ? calcPnlPct(purchasePrice, unitVal) : null,
    pnl_prozent: hasCost ? pnlProzent(purchasePrice, unitVal) : null,
    avg_price: unitVal,
    qty_avg_price: unitVal,
    wert_gesamt: aufRappen(wert_z),
    total_value: (wert_z / 10000).toFixed(4),
    display_value: aufRappen(wert_z).toFixed(2),
  };
}

/** Sum of the row values, rounded only at the end; as a number and (deprecated) as text. */
function total(rows: Array<{ total_value: string }>) {
  const z = rows.reduce((s, r) => s + (inTenThousandths(r.total_value) ?? 0), 0);
  return { wert_gesamt: aufRappen(z), total_value: aufRappen(z).toFixed(2) };
}

/** One implementation for session route and token API. */
export async function valueMinifigs(k: FinancesContext, viewerId: number, idsChoice: Sicht | Blickfeld) {
  const uids = asIds(await k.household.scopeFrom(idsChoice));
  const [currency, ttlHours] = await Promise.all([
    k.einstellungen.userValue(viewerId, 'currency', 'EUR'),
    k.einstellungen.globalValue('price_cache_ttl', '24'),
  ]);
  const ttl = Math.max(1, parseInt(ttlHours, 10) || 24);
  const manualFigs = await k.valuation.manualMinifigsToValuation(uids);
  if (!manualFigs.length)
    return {
      currency,
      figs: [],
      ...total([]),
      kaufpreise_fremde_waehrung: 0,
      kaufpreise_umgerechnet: 0,
      preise_ausstehend: 0,
    };

  const acqByFig = await loadManualAcquisitions(k, uids, 'fig', currency);
  const withBl = manualFigs.filter(f => f.bl_fig_number);
  const [figStock, estimates] = await Promise.all([
    preloadMinifigPrices(
      k,
      withBl.map(f => String(f.bl_fig_number)),
      currency,
      ttlHours,
    ),
    k.marketPrices.estimatedMinifigsPrices(
      manualFigs.filter(f => !f.bl_fig_number).map(f => f.fig_number),
      currency,
      ttl,
    ),
  ]);
  const isMissing: Item[] = [];

  const results = await k.household.attachOwners(
    uids,
    manualFigs.map(fig => {
      // Per occurring condition: a copy bought new gets the new price,
      // even if another one is used.
      const key = fig.fig_number;
      const acqs = acqByFig.get(`${fig.user_id}|${key}`) || [];
      const { priceMap, priceData } = pricesJeState(key, conditionsOf(acqs), (cond): MinifigPrice => {
        if (fig.bl_fig_number) {
          const p = priceFromStock(c => figStock.get(`${fig.bl_fig_number}|${c}`), cond, ttl, k.uhr.jetzt());
          if (p.ausstehend) isMissing.push({ art: 'figur', nummer: fig.bl_fig_number, zustand: cond });
          return p;
        }
        // Without a BL number estimated from the part prices (the job computes the estimate).
        const s = estimates.get(`${key}|${cond}`);
        if (s)
          return {
            min_price: 0,
            avg_price: s.preis,
            max_price: 0,
            qty_avg_price: s.preis,
            from_cache: true,
            estimated_from_parts: true as const,
            abdeckung: s.abdeckung,
          };
        isMissing.push({ art: 'schaetzung', nummer: key, zustand: cond });
        return {
          min_price: 0,
          avg_price: 0,
          max_price: 0,
          qty_avg_price: 0,
          from_cache: false,
          ausstehend: true as const,
        };
      });
      return { ...fig, ...priceData, ...valueManual(key, acqs, priceMap, fig.quantity || 1) };
    }),
  );
  return {
    currency,
    figs: results,
    ...total(results),
    kaufpreise_fremde_waehrung: foreignPurchasePrices(acqByFig),
    kaufpreise_umgerechnet: countFlagged([...acqByFig.values()].flat(), 'kaufpreis_umgerechnet'),
    preise_ausstehend: await rememberPricesForAccountBefore(k, viewerId, currency, isMissing),
  };
}

export async function valueParts(k: FinancesContext, viewerId: number, idsChoice: Sicht | Blickfeld) {
  const uids = asIds(await k.household.scopeFrom(idsChoice));
  const [currency, ttlHours] = await Promise.all([
    k.einstellungen.userValue(viewerId, 'currency', 'EUR'),
    k.einstellungen.globalValue('price_cache_ttl', '24'),
  ]);
  const ttl = Math.max(1, parseInt(ttlHours, 10) || 24);
  const manualParts = await k.valuation.manualPartsToValuation(uids);
  if (!manualParts.length)
    return {
      currency,
      parts: [],
      ...total([]),
      kaufpreise_fremde_waehrung: 0,
      kaufpreise_umgerechnet: 0,
      preise_ausstehend: 0,
    };

  const blNumber = (p: repo.ManuellesTeil) => String(p.bl_part_number || p.part_number);
  await loadBlNumbersBefore(k, manualParts.map(blNumber));
  const acqByPart = await loadManualAcquisitions(k, uids, 'part', currency);
  const partStock = await preloadPartPrices(
    k,
    manualParts.map(p => ({
      partNumber: blNumber(p),
      rbColorId: p.color_id ?? NO_COLOR,
    })),
    currency,
    ttlHours,
  );
  const isMissing: Item[] = [];

  const tasks = manualParts.map(part => async () => {
    const key = `${part.part_number}|${part.color_id ?? NO_COLOR}`;
    const acqs = acqByPart.get(`${part.user_id}|${key}`) || [];
    const stockKey = await partKey(k, blNumber(part), part.color_id ?? NO_COLOR);
    const { priceMap, priceData } = pricesJeState(key, conditionsOf(acqs), cond => {
      const p = priceFromStock(c => partStock.get(`${stockKey}|${c}`), cond, ttl, k.uhr.jetzt());
      if (p.ausstehend)
        isMissing.push({ art: 'teil', nummer: blNumber(part), farbe: part.color_id ?? NO_COLOR, zustand: cond });
      return p;
    });
    const wert = valueManual(key, acqs, priceMap, part.quantity || 1);
    return {
      id: part.id,
      user_id: part.user_id,
      part_number: part.part_number,
      bl_part_number: part.bl_part_number,
      part_name: part.part_name,
      color_id: part.color_id,
      color_name: part.color_name,
      color_hex: part.color_hex,
      quantity: part.quantity || 1,
      image_url: part.image_url,
      image_local: part.image_local,
      // The newest acquisition; the web app only uses the value as a fallback.
      unit_price: acqs.at(-1)?.unit_price ?? null,
      ...priceData,
      // After ...priceData so that the weighted value wins.
      ...wert,
    };
  });

  const results = await k.household.attachOwners(uids, await parallelLimit(tasks, 5));
  return {
    currency,
    parts: results,
    ...total(results),
    kaufpreise_fremde_waehrung: foreignPurchasePrices(acqByPart),
    kaufpreise_umgerechnet: countFlagged([...acqByPart.values()].flat(), 'kaufpreis_umgerechnet'),
    preise_ausstehend: await rememberPricesForAccountBefore(k, viewerId, currency, isMissing),
  };
}
