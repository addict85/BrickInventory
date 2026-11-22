/** What the inventory is worth today; stands on the price layer (prices.ts) and
 * carries the profit calculation, not the other way round. Only the price cache is read:
 * missing prices are fetched by the job "preise_nachladen", not by the request. */

import { logAndContinue } from '../../infra/error';
import type * as repo from '../repository/valuation';
import { asIds, type Viewer } from '../../household';
import { hasPrice, marketPriceFrom } from '../../catalog';
import { resolveImageLocal, proxyImageUrl } from '../../images';
import { valueSet, valueAcquisitionRows, weightedPurchase, pnlPct as calcPnlPct, pnlPercent } from '../setValue';
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
  type Scope,
  type PriceData,
} from './prices';
import { countFlagged } from './queries';
import type { loadSetEntries } from '../repository/acquisitions';
import { NO_COLOR, conditionOf } from '../../infra/validate';
import { toCents, inTenThousandths } from '../../infra/money';
import type { Payload } from '../../jobQueue';
import { PRICE_ITEM_AT_MOST, rememberPricesBefore } from '../priceItems';
import { errorText } from '../../infra/errorTexts';
import type { FinancesContext } from '../context';

type ConditionState = 'N' | 'U';
type Item = Payload<'price_refresh'>['items'][number];
type MinifigPrice = PriceData & { estimated_from_parts?: true; abdeckung?: number | null };

/** @returns Map key → acquisition rows; key is `konto|nummer|color` or `konto|nummer` */
async function loadManualAcquisitions(k: FinancesContext, uid: Scope, kind: 'part' | 'fig', currency: string) {
  // A main account values the whole household; the currency is forced to be
  // the same when linking, otherwise this would sum two currencies.
  const rows = await k.valuation.manualEntries(kind, asIds(uid), currency);
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

function foreignPurchasePrices(perEntry: Map<string, Array<{ purchase_price_foreign?: boolean }>>): number {
  let n = 0;
  for (const rows of perEntry.values()) n += rows.filter(z => z.purchase_price_foreign).length;
  return n;
}

/** The valuation reports everything that is missing; the job per account and currency picks it up. */
async function rememberPricesForAccountBefore(
  k: FinancesContext,
  viewerId: number,
  currency: string,
  item: Item[],
): Promise<number> {
  if (!item.length) return 0;
  await rememberPricesBefore(k, { user_id: viewerId, currency, items: item.slice(0, PRICE_ITEM_AT_MOST) }).catch(
    logAndContinue('bewertung:preise vormerken'),
  );
  return item.length;
}

type ValuedSet = Awaited<ReturnType<typeof repo.setsToValuation>>[number];
type SetEntry = Awaited<ReturnType<typeof loadSetEntries>>[number];
/** What every row needs: the viewer's settings and the preloaded tables. */
type ValuationState = {
  ttl: number;
  now: number;
  pre: Parameters<typeof setPriceFromStock>[4];
  missing: Item[];
  withoutAccess: string | null;
};

/** One row of the valuation: per purchase price the price of ITS condition, condensed
 * in valueSet(), so that the valuation rule stays in ONE place. */
function assessSet(set: ValuedSet, acqs: SetEntry[], l: ValuationState) {
  // Without an acquisition the set counts as new (effectiveCondition without counters).
  const fallbackCond: ConditionState = 'N';
  const needed: ConditionState[] = acqs.length ? [...new Set(acqs.map(a => conditionOf(a.condition)))] : [fallbackCond];
  const prices = new Map<ConditionState, PriceData>(
    needed.map(c => [c, setPriceFromStock(set.set_number, c, l.ttl, l.now, l.pre)]),
  );
  const priceMap = new Map<string, number>();
  for (const [cond, p] of prices) {
    const market = marketPriceFrom(p);
    if (market !== null) priceMap.set(`${set.set_number}|${cond}`, market);
    if (p.pending) l.missing.push({ kind: 'set', number: set.set_number, condition: cond });
  }
  const valued = valueSet(set.set_number, acqs, priceMap, fallbackCond, set.quantity || 1);
  const rows = valueAcquisitionRows(set.set_number, acqs, priceMap);
  // Without an acquisition no purchase price, not 0: a 0 would look like a gift.
  const purchase = weightedPurchase(rows);
  // Min/max must match the same quantity split as the average.
  const qty = valued.quantity || 1;
  const weighted = (key: 'min_price' | 'max_price' | 'qty_avg_price') =>
    valued.by_condition
      .map(bc => (prices.get(bc.condition as ConditionState)?.[key] ?? 0) * bc.quantity)
      .reduce((a, b) => a + b, 0) / qty;
  const onePrice = needed.map(c => prices.get(c)).find(p => p && !p.pending);
  const pending = needed.some(c => prices.get(c)?.pending === true);
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
    total_avg: toCents((valued.unit_z ?? 0) * qty).toFixed(2),
    value_total: toCents((valued.unit_z ?? 0) * qty),
    total_qty_avg: toCents((inTenThousandths(weighted('qty_avg_price')) ?? 0) * qty).toFixed(2),
    pnl_pct: calcPnlPct(purchase, unitAvg),
    pnl_percent: pnlPercent(purchase, unitAvg),
    acquisitions: rows,
    from_cache: true,
    is_fallback: onePrice?.is_fallback === true,
    // A pending price is not a price yet; a check mark would mean "loaded".
    no_price: (!!onePrice || pending) && valued.unit_price == null,
    bl_unknown: needed.some(c => prices.get(c)?.bl_unknown === true),
    price_pending: pending,
    ...(pending && l.withoutAccess && valued.unit_price == null
      ? { error: l.withoutAccess, error_code: 'no_bricklink_access' }
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
    min: toCents(zMin).toFixed(2),
    avg: toCents(zAvg).toFixed(2),
    max: toCents(zMax).toFixed(2),
    qty_avg: toCents(zQtyAvg).toFixed(2),
  };
}

/** One implementation for session route and token API. */
export async function valueSets(kx: FinancesContext, viewerId: number, idsChoice: Viewer | Scope) {
  // viewerId determines the settings, ids the calculated data: with the
  // filter "sub-accounts" the asking account is missing from ids.
  const uids = await kx.household.scopeFrom(idsChoice);
  const [currency, ttlHours, guideType] = await Promise.all([
    kx.settings.userValue(viewerId, 'currency', 'EUR'),
    kx.settings.userValue(viewerId, 'price_cache_ttl', '24'),
    kx.settings.userValue(viewerId, 'price_guide_type', 'sold'),
  ]);
  const header = {
    currency,
    condition: DEFAULT_PRICE_CONDITION,
    guide_type: guideType,
    ttl_hours: ttlHours,
    // ttl_hours stays text for older clients.
    cache_ttl_hours: Number(ttlHours) || 24,
  };
  const sets = await kx.valuation.setsToValuation(uids);
  if (!sets.length)
    return {
      ...header,
      foreign_currency_purchases: 0,
      converted_purchase_prices: 0,
      sets: [],
      prices_pending: 0,
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
  const withoutAccess = (await kx.settings.globalValue('bricklink_consumer_key'))
    ? null
    : errorText(
        'no_bricklink_access',
        (await kx.settings.userValue(viewerId, 'language', 'de')) === 'en' ? 'en' : 'de',
      );
  const situation: ValuationState = {
    ttl,
    now: kx.clock.now(),
    missing: [],
    withoutAccess,
    pre: {
      catalog: new Map(catRows.map(r => [r.set_number, r])),
      cache: new Map(cacheRows.map(r => [`${r.set_number}|${r.condition}`, r])),
    },
  };
  // Per account and set: in the household every row is the inventory of ONE account.
  const perAccountAndSet = new Map<string, SetEntry[]>();
  for (const a of acqRows) {
    const k = `${a.user_id}|${a.set_number}`,
      l = perAccountAndSet.get(k);
    if (l) l.push(a);
    else perAccountAndSet.set(k, [a]);
  }
  const results = await kx.household.attachOwners(
    uids,
    sets.map(set => assessSet(set, perAccountAndSet.get(`${set.user_id}|${set.set_number}`) || [], situation)),
  );
  return {
    ...header,
    // Foreign purchase prices are missing from the sums (no rates); the number says how many there are.
    foreign_currency_purchases: countFlagged(acqRows, 'purchase_price_foreign'),
    converted_purchase_prices: countFlagged(acqRows, 'purchase_price_converted'),
    sets: results,
    totals: valuationSums(results),
    prices_pending: await rememberPricesForAccountBefore(kx, viewerId, currency, situation.missing),
  };
}

function conditionsOf(acqs: { condition?: string | null }[]): ConditionState[] {
  if (!acqs?.length) return ['N'];
  const set = new Set(acqs.map(a => conditionOf(a.condition)));
  return (['N', 'U'] as const).filter(c => set.has(c));
}

/** One price per occurring condition; the first one with a value carries the row's additional details. */
function pricesPerState<P extends PriceData>(key: string, conds: ConditionState[], priceOf: (c: ConditionState) => P) {
  const priceMap = new Map<string, number>();
  let priceData: P | null = null;
  for (const cond of conds) {
    const pd = priceOf(cond);
    const v = marketPriceFrom(pd);
    if (v !== null) priceMap.set(`${key}|${cond}`, v);
    if (!priceData || (!hasPrice(priceData) && v !== null)) priceData = pd;
  }
  return { priceMap, priceData };
}

function valueManual(key: string, acqs: repo.ManualEntry[], priceMap: Map<string, number>, quantity: number) {
  // 'N': the fallback only applies without acquisitions, and there "new" applies.
  const valued = valueSet(key, acqs, priceMap, 'N', quantity);
  const rows = valueAcquisitionRows(key, acqs, priceMap);
  const unitVal = valued.unit_price ?? 0;
  const totalQty = acqs.length ? valued.quantity : quantity;
  // A purchase price only counts in the account currency; a foreign currency or "unknown"
  // as 0 would drive the P&L to tens of thousands of percent.
  const acqPurchase = acqs.length ? weightedPurchase(rows) : null;
  const hasCost = acqPurchase != null;
  const purchasePrice = acqPurchase ?? 0;
  const value_z = (valued.unit_z ?? 0) * totalQty;
  return {
    condition: valued.by_condition.some(b => b.condition === 'U') ? 'U' : 'N',
    conditions: valued.by_condition.map(b => b.condition),
    acquisitions: rows,
    purchase_price: hasCost ? purchasePrice : null,
    pnl_pct: hasCost ? calcPnlPct(purchasePrice, unitVal) : null,
    pnl_percent: hasCost ? pnlPercent(purchasePrice, unitVal) : null,
    avg_price: unitVal,
    qty_avg_price: unitVal,
    value_total: toCents(value_z),
    total_value: (value_z / 10000).toFixed(4),
    display_value: toCents(value_z).toFixed(2),
  };
}

/** Sum of the row values, rounded only at the end; as a number and (deprecated) as text. */
function total(rows: Array<{ total_value: string }>) {
  const z = rows.reduce((s, r) => s + (inTenThousandths(r.total_value) ?? 0), 0);
  return { value_total: toCents(z), total_value: toCents(z).toFixed(2) };
}

/** One implementation for session route and token API. */
export async function valueMinifigs(k: FinancesContext, viewerId: number, idsChoice: Viewer | Scope) {
  const uids = asIds(await k.household.scopeFrom(idsChoice));
  const [currency, ttlHours] = await Promise.all([
    k.settings.userValue(viewerId, 'currency', 'EUR'),
    k.settings.globalValue('price_cache_ttl', '24'),
  ]);
  const ttl = Math.max(1, parseInt(ttlHours, 10) || 24);
  const manualFigs = await k.valuation.manualMinifigsToValuation(uids);
  if (!manualFigs.length)
    return {
      currency,
      figs: [],
      ...total([]),
      foreign_currency_purchases: 0,
      converted_purchase_prices: 0,
      prices_pending: 0,
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
      const { priceMap, priceData } = pricesPerState(key, conditionsOf(acqs), (cond): MinifigPrice => {
        if (fig.bl_fig_number) {
          const p = priceFromStock(c => figStock.get(`${fig.bl_fig_number}|${c}`), cond, ttl, k.clock.now());
          if (p.pending) isMissing.push({ kind: 'figur', number: fig.bl_fig_number, condition: cond });
          return p;
        }
        // Without a BL number estimated from the part prices (the job computes the estimate).
        const s = estimates.get(`${key}|${cond}`);
        if (s)
          return {
            min_price: 0,
            avg_price: s.price,
            max_price: 0,
            qty_avg_price: s.price,
            from_cache: true,
            estimated_from_parts: true as const,
            abdeckung: s.abdeckung,
          };
        isMissing.push({ kind: 'schaetzung', number: key, condition: cond });
        return {
          min_price: 0,
          avg_price: 0,
          max_price: 0,
          qty_avg_price: 0,
          from_cache: false,
          pending: true as const,
        };
      });
      return { ...fig, ...priceData, ...valueManual(key, acqs, priceMap, fig.quantity || 1) };
    }),
  );
  return {
    currency,
    figs: results,
    ...total(results),
    foreign_currency_purchases: foreignPurchasePrices(acqByFig),
    converted_purchase_prices: countFlagged([...acqByFig.values()].flat(), 'purchase_price_converted'),
    prices_pending: await rememberPricesForAccountBefore(k, viewerId, currency, isMissing),
  };
}

export async function valueParts(k: FinancesContext, viewerId: number, idsChoice: Viewer | Scope) {
  const uids = asIds(await k.household.scopeFrom(idsChoice));
  const [currency, ttlHours] = await Promise.all([
    k.settings.userValue(viewerId, 'currency', 'EUR'),
    k.settings.globalValue('price_cache_ttl', '24'),
  ]);
  const ttl = Math.max(1, parseInt(ttlHours, 10) || 24);
  const manualParts = await k.valuation.manualPartsToValuation(uids);
  if (!manualParts.length)
    return {
      currency,
      parts: [],
      ...total([]),
      foreign_currency_purchases: 0,
      converted_purchase_prices: 0,
      prices_pending: 0,
    };

  const blNumber = (p: repo.ManualPart) => String(p.bl_part_number || p.part_number);
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
    const { priceMap, priceData } = pricesPerState(key, conditionsOf(acqs), cond => {
      const p = priceFromStock(c => partStock.get(`${stockKey}|${c}`), cond, ttl, k.clock.now());
      if (p.pending)
        isMissing.push({ kind: 'teil', number: blNumber(part), farbe: part.color_id ?? NO_COLOR, condition: cond });
      return p;
    });
    const value = valueManual(key, acqs, priceMap, part.quantity || 1);
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
      ...value,
    };
  });

  const results = await k.household.attachOwners(uids, await parallelLimit(tasks, 5));
  return {
    currency,
    parts: results,
    ...total(results),
    foreign_currency_purchases: foreignPurchasePrices(acqByPart),
    converted_purchase_prices: countFlagged([...acqByPart.values()].flat(), 'purchase_price_converted'),
    prices_pending: await rememberPricesForAccountBefore(k, viewerId, currency, isMissing),
  };
}
