/** THE one implementation for web app and Android API, so that both show the same chart. */

import { setState, resolveBlColorId, resolveBlPartNumber } from './financeCalc';
import { asIds, type Sicht } from '../household';
import { buildChart } from './chartData';
import { marketPriceFrom } from '../catalog';
import { developmentPercent } from './setValue';
import type { FinancesContext } from './context';

/** Only conditions with an acquisition: otherwise a curve would stand without a reference value.
 * @param fallback What applies if there is NO acquisition AT ALL. */
export function statesForHistory(claimed: string[], fallback: string[]): string[] {
  return claimed.length ? claimed : fallback;
}

export interface PricePoint {
  avg_price: number | null;
  qty_avg_price: number | null;
  min_price: number | null;
  max_price: number | null;
  recorded_at: string;
  is_purchase_price?: boolean;
}

/** DISTINCT ON per day: several fetches on the same day would otherwise yield points
 * on top of each other. The most recent of the day is taken. */
async function seriesFor(
  k: FinancesContext,
  setNumber: string,
  currency: string,
  cond: 'N' | 'U',
): Promise<PricePoint[]> {
  return k.priceHistory.dailyPricesOfSets(setNumber, currency, cond);
}

/** Market versus purchase price in one condition; pnl_pct is the old text form. */
interface StateComparison {
  market_price: number | null;
  purchase_price: number | null;
  pnl_pct: string | null;
  pnl_percent: number | null;
}

/** @param uid Scope: in the household the set often belongs to a sub-account; with
 *   the bare viewer ID the query would not find it. */
type HistoryPoint = Awaited<ReturnType<typeof seriesFor>>[number];

/** The purchase as the first point, unless the series already starts earlier. */
function withPurchasePoint(target: HistoryPoint[], day: string, purchasePrice: number): void {
  const firstDay = target[0]?.recorded_at;
  if (firstDay && day > firstDay) return;
  target.unshift({
    qty_avg_price: purchasePrice,
    avg_price: purchasePrice,
    min_price: null,
    max_price: null,
    recorded_at: day,
    is_purchase_price: true,
  });
}

/** null = no purchase price captured, 0 = gift; both without a percentage. */
function stateComparisons(
  acqByCond: { condition: string | null; avg_purchase: unknown }[],
  current: { N: Parameters<typeof marketPriceFrom>[0]; U: Parameters<typeof marketPriceFrom>[0] },
): Record<string, StateComparison> {
  const byCondition: Record<string, StateComparison> = {};
  for (const cond of ['N', 'U'] as const) {
    const acq = acqByCond.find(r => (r.condition || 'N') === cond);
    if (!acq) continue; // no purchase price entry → no row
    const market = marketPriceFrom(cond === 'N' ? current.N : current.U);
    const base = acq.avg_purchase == null ? null : parseFloat(String(acq.avg_purchase));
    const e = developmentPercent(base, market);
    byCondition[cond] = {
      market_price: market,
      purchase_price: base,
      pnl_pct: e == null ? null : e.toFixed(1),
      pnl_percent: e == null ? null : Number(e.toFixed(1)),
    };
  }
  return byCondition;
}

export async function priceHistorySet(
  k: FinancesContext,
  uidChoice: Sicht | number | number[],
  setNumber: string,
  currency: string,
) {
  const uids = asIds(await k.household.scopeFrom(uidChoice));
  const condition = await setState(k, uids, setNumber);

  const [historyNew, historyUsed] = await Promise.all([
    seriesFor(k, setNumber, currency, 'N'),
    seriesFor(k, setNumber, currency, 'U'),
  ]);

  const currentRows = await k.priceHistory.cachePricesOfSets(setNumber, currency);
  const now = (c: string) => {
    const r = currentRows.find(z => z.condition === c);
    return r ? { ...r, avg_price: marketPriceFrom(r) } : null;
  };
  const current = { N: now('N'), U: now('U') };

  // Purchase price from the FIRST acquisition; every set row has at least one.
  const set = await k.priceHistory.firstPurchaseOfSets(uids, setNumber, currency);

  const hasCost = set?.purchase_price != null; // 0 counts as captured
  const purchasePrice = Number(set?.purchase_price ?? 0);

  // On the series of ITS condition, otherwise the chart would compare a
  // used purchase with the new price.
  if (hasCost && set?.added_day)
    withPurchasePoint(condition === 'U' ? historyUsed : historyNew, set.added_day, purchasePrice);

  // Against the CURRENT price in the inventory's condition, not against the
  // higher one in each case; without a purchase price against the oldest market price.
  const own = condition === 'U' ? historyUsed : historyNew;
  const firstMarket = own.find(p => !p.is_purchase_price);
  const firstHistPrice = marketPriceFrom(firstMarket) ?? 0;
  const baselinePrice = hasCost ? purchasePrice : firstHistPrice;
  const baselineHas = hasCost || firstHistPrice > 0;
  const currentPrice = marketPriceFrom(condition === 'U' ? current.U : current.N) ?? 0;
  const pnlPct = baselineHas ? (developmentPercent(baselinePrice, currentPrice)?.toFixed(1) ?? null) : null;

  // Only conditions with an acquisition, otherwise a percentage against nothing would stand there.
  const byCondition = stateComparisons(await k.priceHistory.purchaseAverageOfSets(uids, setNumber, currency), current);

  const statesForChart = statesForHistory(Object.keys(byCondition), [condition]);
  const chart = buildChart(statesForChart.map(c => ({ name: c, rows: c === 'U' ? historyUsed : historyNew })));

  return {
    currency,
    condition,
    by_condition: byCondition,
    history_new: historyNew,
    history_used: historyUsed,
    current,
    pnl_pct: pnlPct,
    pnl_percent: pnlPct == null ? null : Number(pnlPct),
    purchase_price: hasCost ? purchasePrice : null,
    chart,
  };
}

// ── Price history of manual parts and minifigures ───────────────────────────
// The same response shape as for sets; web and app both ask here.

/** Only for conditions with an acquisition, otherwise the percentage would lack its basis. */
export async function conditionRows(
  k: FinancesContext,
  kind: 'part' | 'fig',
  keySql: string,
  keyVals: unknown[],
  uid: number | number[],
  currency: string,
  acqKeySql: string = keySql,
  acqKeyVals: unknown[] = keyVals,
) {
  const uids = asIds(uid);
  // DESC: since the figure history queries both numbers, there can be two rows
  // per condition, and `.find()` should take the newest.
  const cacheRows = await k.priceHistory.cachePricesAfterKey(kind, keySql, keyVals, currency);
  const acqRows = await k.priceHistory.purchaseAveragesByKey(kind, acqKeySql, acqKeyVals, uids, currency);

  const out: Record<string, StateComparison> = {};
  for (const cond of ['N', 'U'] as const) {
    const acq = acqRows.find(r => (r.condition || 'N') === cond);
    if (!acq) continue; // no purchase price entry → no row
    const market = marketPriceFrom(cacheRows.find(r => r.condition === cond));
    const base = acq.avg_purchase == null ? null : parseFloat(String(acq.avg_purchase));
    const e = developmentPercent(base, market);
    out[cond] = {
      market_price: market,
      purchase_price: base,
      pnl_pct: e == null ? null : e.toFixed(1),
      pnl_percent: e == null ? null : Number(e.toFixed(1)),
    };
  }
  return out;
}

/** @param keySql/keyVals  Keys for PRICES (under the BrickLink number).
 * @param acqKeySql/acqKeyVals  Keys for ACQUISITIONS (the user's number). */
async function manualPriceHistory(
  k: FinancesContext,
  uid: number | number[],
  currency: string,
  kind: 'part' | 'fig',
  keySql: string,
  keyVals: unknown[],
  acqKeySql: string = keySql,
  acqKeyVals: unknown[] = keyVals,
) {
  const [historyNew, historyUsed, by_condition] = await Promise.all([
    k.priceHistory.manualSeries(kind, keySql, keyVals, currency, 'N'),
    k.priceHistory.manualSeries(kind, keySql, keyVals, currency, 'U'),
    conditionRows(k, kind, keySql, keyVals, uid, currency, acqKeySql, acqKeyVals),
  ]);
  // Only conditions with an acquisition are drawn; the raw series stay complete.
  const states = statesForHistory(Object.keys(by_condition), ['N', 'U']);
  return {
    currency,
    by_condition,
    history_new: historyNew,
    history_used: historyUsed,
    chart: buildChart(states.map(c => ({ name: c, rows: c === 'U' ? historyUsed : historyNew }))),
  };
}

export async function priceHistoryPart(
  k: FinancesContext,
  uidChoice: Sicht | number | number[],
  partNumber: string,
  colorId: number,
  currency: string,
) {
  const uid = await k.household.scopeFrom(uidChoice);
  // Prices are stored under BrickLink number and color, acquisitions under those
  // of the user — the two key spaces must not be mixed.
  const blNumber = await resolveBlPartNumber(k, partNumber, Array.isArray(uid) ? (uid[0] ?? null) : uid);
  const blColor = await resolveBlColorId(k, colorId);
  const numbers = [...new Set([blNumber, partNumber])];
  return manualPriceHistory(
    k,
    uid,
    currency,
    'part',
    'part_number = ANY($1) AND color_id = $2',
    [numbers, blColor],
    'part_number = $1 AND color_id = $2',
    [partNumber, colorId],
  );
}

// Prices are under the BrickLink number, acquisitions under the own one; both keys count.
export async function priceHistoryMinifig(
  k: FinancesContext,
  uidChoice: Sicht | number | number[],
  figNumber: string,
  currency: string,
) {
  const uid = await k.household.scopeFrom(uidChoice);
  const numbers = await priceNumbersForMinifig(k, uid, figNumber);
  return manualPriceHistory(
    k,
    uid,
    currency,
    'fig',
    'fig_number = ANY($1)',
    [numbers],
    // The acquisitions only carry the user's number.
    'fig_number = $1',
    [figNumber],
  );
}

/** The own number and, if stored, the BrickLink number; duplicates are dropped. */
async function priceNumbersForMinifig(
  k: FinancesContext,
  uid: number | number[],
  figNumber: string,
): Promise<string[]> {
  const bl = await k.catalog.blNumberOf('fig', figNumber, uid);
  return [...new Set([figNumber, ...(bl ? [bl] : [])])];
}

/** @returns number of removed rows */
export async function deleteOldPrices(k: FinancesContext): Promise<number> {
  const days = k.config.priceHistoryDays;
  if (days <= 0) return 0;
  const r = await k.priceHistory.deleteOldHistory(String(days));
  return r?.changes || 0;
}
