/** Per acquisition with the price of its condition, because mixed inventories would otherwise
 * get a wrong average. */
import { inTenThousandths, aufRappen, alsText } from '../infra/money';
import { conditionOf } from '../infra/validate';
import type { FinancesContext } from './context';

export interface SetValue {
  unit_price: number | null;
  /** Unrounded, in ten-thousandths: sums are calculated with this, not with the rounded one. */
  unit_z: number | null;
  total: number | null;
  quantity: number;
  by_condition: { condition: 'N' | 'U'; quantity: number; unit_price: number | null }[];
}

/** `"0.00"` from NUMERIC yields 0, not truthy. */
function num(v: unknown): number {
  const n = parseFloat(String(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** In ONE query for many sets.
 * @returns Map "setNumber|condition" → market price */
export async function loadConditionPrices(
  k: FinancesContext,
  setNumbers: string[],
  currency: string,
  ttlHours?: number,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const list = [...new Set((setNumbers || []).filter(Boolean))];
  if (!list.length) return out;

  const ttlClause = ttlHours ? ' AND fetched_at > NOW() - make_interval(hours => $3)' : '';
  const params: (string[] | string | number)[] = [list, currency];
  if (ttlHours) params.push(ttlHours);

  const rows = await k.setWert.cachePricesForSets(params, ttlClause);

  for (const r of rows) {
    const p = num(r.market_price);
    if (p > 0) out.set(`${r.set_number}|${r.condition}`, p);
  }
  return out;
}

function priceFor(prices: Map<string, number>, setNumber: string, cond: string): number | null {
  const want = prices.get(`${setNumber}|${cond}`);
  if (want) return want;
  const other = prices.get(`${setNumber}|${cond === 'N' ? 'U' : 'N'}`);
  return other || null;
}

/** @param acquisitions Empty = no acquisitions; then fallbackCondition counts
 *        with fallbackQuantity. */
export function valueSet(
  setNumber: string,
  acquisitions: { quantity: number; condition?: string | null }[],
  prices: Map<string, number>,
  fallbackCondition: string = 'N',
  fallbackQuantity: number = 1,
): SetValue {
  const rows = acquisitions?.length
    ? acquisitions.map(a => ({
        condition: conditionOf(a.condition),
        quantity: Math.max(1, parseInt(String(a.quantity), 10) || 1),
      }))
    : [{ condition: conditionOf(fallbackCondition), quantity: Math.max(1, fallbackQuantity) }];

  const byCond = new Map<'N' | 'U', number>();
  for (const r of rows) byCond.set(r.condition, (byCond.get(r.condition) || 0) + r.quantity);

  let totalZ = 0,
    quantity = 0,
    priced = 0;
  const by_condition: SetValue['by_condition'] = [];

  for (const [condition, qty] of byCond) {
    const unit = priceFor(prices, setNumber, condition);
    by_condition.push({ condition, quantity: qty, unit_price: unit });
    quantity += qty;
    const z = inTenThousandths(unit);
    if (z !== null) {
      totalZ += z * qty;
      priced += qty;
    }
  }

  // No condition has a price → no value, not 0: a 0 would look in the
  // sums like a known value.
  if (priced === 0) return { unit_price: null, unit_z: null, total: null, quantity, by_condition };

  // Over the PRICED pieces, so that a missing price does not pull the unit price
  // down. Rounding happens only here.
  return {
    unit_price: aufRappen(totalZ / priced),
    unit_z: totalZ / priced,
    total: aufRappen(totalZ),
    quantity,
    by_condition,
  };
}

/** For lists loadConditionPrices() + valueSet(), so that it stays at one query. */
export async function getSetValue(
  k: FinancesContext,
  userId: number,
  setNumber: string,
  currency: string,
): Promise<SetValue> {
  const acqs = await k.setWert.setEntriesToValue(userId, setNumber);
  const prices = await loadConditionPrices(k, [setNumber], currency);
  return valueSet(setNumber, acqs, prices, 'N', 1);
}

// Every acquisition with the market price of ITS condition — for the finance table.

/** The one rule for sets, parts, figures, tile and history. null for a
 * purchase price of 0: against a gift there is no percentage (against 0.01
 * it showed "+327,600 %"). */
export function developmentPercent(
  purchase: number | null | undefined,
  market: number | null | undefined,
): number | null {
  if (purchase == null || !(purchase > 0) || market == null || !(market > 0)) return null;
  return ((market - purchase) / purchase) * 100;
}

export function pnlPercent(purchase: number | null, market: number | null): number | null {
  const t = pnlPct(purchase, market);
  return t === null ? null : Number(t);
}

export function pnlPct(purchase: number | null, market: number | null): string | null {
  return developmentPercent(purchase, market)?.toFixed(1) ?? null;
}

export interface AcquisitionValueRow {
  id: number;
  condition: 'N' | 'U';
  quantity: number;
  /** null = no purchase price captured. 0 = captured and gifted — not the same. */
  purchase_price: number | null;
  avg_price: number | null;
  total_avg: string | null;
  value_total: number | null;
  pnl_pct: string | null;
  pnl_percent: number | null;
  created_at: Date | string | null;
  /** A purchase price in a foreign currency without a rate: it does not count, but it is shown. */
  original_purchase_price?: number;
  purchase_currency?: string;
  price_estimated?: true;
}

/** What an acquisition brings for its value; purchase_price for sets, unit_price otherwise. */
export interface EntryForValue {
  id: number;
  condition?: string | null;
  quantity: number | string;
  purchase_price?: number | string | null;
  unit_price?: number | string | null;
  created_at?: Date | string | null;
  currency?: string | null;
  purchase_price_foreign?: boolean | null;
  original_purchase_price?: number | string | null;
  price_estimated?: boolean | null;
}

/** The price paid in another currency, as it was entered. */
function foreignPurchase(a: EntryForValue) {
  return a.purchase_price_foreign && a.original_purchase_price != null
    ? { original_purchase_price: parseFloat(String(a.original_purchase_price)), purchase_currency: String(a.currency) }
    : {};
}

function valueRow(setNumber: string, a: EntryForValue, prices: Map<string, number>): AcquisitionValueRow {
  const condition: 'N' | 'U' = a.condition === 'U' ? 'U' : 'N';
  const quantity = Math.max(1, parseInt(String(a.quantity), 10) || 1);
  // purchase_price (sets) and unit_price (manual) are the same quantity under
  // two names; reading both saves one version of this function each.
  const raw = a.purchase_price ?? a.unit_price;
  const purchase = raw === null || raw === undefined ? null : parseFloat(String(raw)) || 0;
  const unit = priceFor(prices, setNumber, condition);
  const total = unit != null ? aufRappen((inTenThousandths(unit) ?? 0) * quantity) : null;
  return {
    id: a.id,
    condition,
    quantity,
    purchase_price: purchase,
    avg_price: unit,
    total_avg: total != null ? alsText(total) : null,
    value_total: total,
    pnl_pct: pnlPct(purchase, unit),
    pnl_percent: pnlPercent(purchase, unit),
    created_at: a.created_at ?? null,
    ...foreignPurchase(a),
    ...(a.price_estimated && purchase != null ? { price_estimated: true as const } : {}),
  };
}

/** @param prices Map "setNumber|condition" → market price (loadConditionPrices) */
export function valueAcquisitionRows(
  setNumber: string,
  acquisitions: EntryForValue[],
  prices: Map<string, number>,
): AcquisitionValueRow[] {
  return (acquisitions || []).map(a => valueRow(setNumber, a, prices));
}

/** Only over rows WITH a purchase price: an acquisition without a price would otherwise pull
 * the average towards zero. */
export function weightedPurchase(rows: AcquisitionValueRow[]): number | null {
  const withCost = (rows || []).filter(r => r.purchase_price != null);
  const qty = withCost.reduce((s, r) => s + r.quantity, 0);
  if (!qty) return null;
  return withCost.reduce((s, r) => s + (r.purchase_price as number) * r.quantity, 0) / qty;
}

export interface TileValue {
  tile_price: number | null;
  tile_pnl_pct: number | null;
  tile_source: 'market' | 'purchase' | null;
}

export interface TileSource {
  set_number: string;
  quantity: number;
  current_price: number | null;
  purchase_price: number | null;
  baseline_price: number | null;
  pnl_pct: string | null;
  baseline_pnl_pct: string | null;
}

/** Average of a price field, weighted by quantity; null without any value. */
function weightedBy(zs: TileSource[], field: 'baseline_price' | 'purchase_price'): number | null {
  let sum = 0,
    quantity = 0;
  for (const z of zs) {
    const b = z[field];
    if (b == null) continue;
    const m = Math.max(1, Number(z.quantity) || 1);
    sum += Number(b) * m;
    quantity += m;
  }
  return quantity > 0 ? sum / quantity : null;
}

/** One row brings its own percentage; several are weighted against the market price. */
function tilePct(zs: TileSource[], market: number): number | null {
  if (zs.length === 1) {
    const t = zs[0]!.baseline_pnl_pct || zs[0]!.pnl_pct;
    return t == null ? null : Number(t);
  }
  const e = developmentPercent(weightedBy(zs, 'baseline_price'), market);
  return e == null ? null : Math.round(e * 10) / 10;
}

/** In the household the base price weighted by quantity counts: "any row"
 * would yield a different percentage depending on the order. */
export function tileValues(rows: TileSource[]): Map<string, TileValue> {
  const jeSet = new Map<string, TileSource[]>();
  for (const z of rows) jeSet.set(z.set_number, [...(jeSet.get(z.set_number) || []), z]);
  const from = new Map<string, TileValue>();
  for (const [nr, zs] of jeSet) {
    const market = Number(zs[0]?.current_price) || 0;
    const purchase = weightedBy(zs, 'purchase_price');
    const source = market > 0 ? 'market' : purchase != null ? 'purchase' : null;
    const shown = source === 'market' ? market : purchase;
    from.set(nr, {
      tile_price: shown != null ? aufRappen(inTenThousandths(shown) ?? 0) : null,
      tile_pnl_pct: tilePct(zs, market),
      tile_source: source,
    });
  }
  return from;
}
