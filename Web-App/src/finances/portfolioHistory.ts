import type { Sicht } from '../household';
import { buildChartData } from './portfolio/chartData';
import { reconstructCurve, type CurvesPoint } from './portfolio/curve';
import { DEFAULT_PRICE_CONDITION } from './financeCalc';
import type { FinancesContext } from './context';
/** The last point per month; the first stays exact so that all periods begin at the same start. */
function onMonths(rawPoints: CurvesPoint[]): CurvesPoint[] {
  const byMonth = new Map<string, CurvesPoint>();
  for (const p of rawPoints) byMonth.set(p.month || p.day.slice(0, 7), p);
  const monthly = [...byMonth.values()].map(p => ({ ...p, day: p.month || p.day.slice(0, 7) }));
  const first = rawPoints[0];
  if (first && monthly[0] && monthly[0].fullDay !== first.fullDay) {
    monthly[0] = { ...first, day: first.month || first.day.slice(0, 7) };
  }
  return monthly;
}

/** An artificial start value so that the app has a line; `messpunkte` tells the web UI that this is no history. */
function withStartPoint(rawPoints: CurvesPoint[], period: string, purchaseTotal: number, now: Date): CurvesPoint[] {
  const pad = (n: number) => String(n).padStart(2, '0');
  const startDate = new Date(now);
  if (period === 'week') startDate.setDate(now.getDate() - 7);
  else if (period === 'month') startDate.setDate(now.getDate() - 30);
  else if (period === 'year') startDate.setFullYear(now.getFullYear() - 1);
  else startDate.setFullYear(now.getFullYear() - 5);
  const baseVal = rawPoints[0] ? rawPoints[0].total : Math.max(purchaseTotal, 0);
  if (!(baseVal > 0)) return rawPoints;
  const startFullDay = `${startDate.getFullYear()}-${pad(startDate.getMonth() + 1)}-${pad(startDate.getDate())}`;
  return [{ day: startFullDay, fullDay: startFullDay, total: baseVal }, ...rawPoints];
}

/** `db` and `getSetting` can be passed in so that the calculation stays testable
 * without a database. */
export async function portfolioHistory(
  k: FinancesContext,
  viewerId: number,
  idsChoice: Sicht | number[],
  period: string,
  db: unknown = k.db,
  getSetting: (userId: number, key: string, fallback: string) => Promise<string> = k.einstellungen.userValue,
) {
  const ids = await k.household.scopeFrom(idsChoice);
  // With the filter "sub-accounts" ids does not contain the asking account; the
  // currency must then not come from ids[0].
  const uids = Array.isArray(ids) ? ids.map(n => parseInt(String(n), 10)) : [parseInt(String(ids), 10)];
  const currency = await getSetting(viewerId, 'currency', 'EUR');
  const condition = DEFAULT_PRICE_CONDITION;

  // One set, ONE row, even with two owners — otherwise it would enter the sum twice.
  const sets = await k.portfolioCurve.setsWithPurchaseTotal(uids);
  if (!sets.length) {
    return { currency, period, points: [], y_axis: [], period_change_pct: null, messpunkte: 0 };
  }

  const setNumbers = sets.map((s: { set_number: string }) => s.set_number);
  const setQty = Object.fromEntries(sets.map(s => [s.set_number, s.quantity || 1]));
  const placeholders = setNumbers.map((_: unknown, i: number) => `$${i + 3}`).join(',');
  const purchaseTotal = sets.reduce((s: number, r) => s + (Number(r.purchase_price) || 0) * (r.quantity || 1), 0);

  let dateFilter = '';
  if (period === 'week') dateFilter = "AND recorded_at >= NOW() - INTERVAL '7 days'";
  else if (period === 'month') dateFilter = "AND recorded_at >= NOW() - INTERVAL '30 days'";
  else if (period === 'year') dateFilter = "AND recorded_at >= NOW() - INTERVAL '365 days'";

  // For week and month per day, for year and max per MONTH.
  let monthResolution = period === 'year' || period === 'max';
  const bucketExpr = monthResolution ? "'YYYY-MM'" : "'YYYY-MM-DD'";

  // The curve shows TODAY's inventory over time: otherwise every
  // capture would appear as a price jump.

  const curve = await reconstructCurve(k, {
    db,
    setNumbers,
    setQty,
    placeholders,
    dateFilter,
    bucketExpr,
    condition,
    currency,
    monthResolution,
  });
  let rawPoints = curve.rawPoints;
  monthResolution = curve.monthResolution;
  const messpunkte = rawPoints.length;

  // The labeling must know the condensing, otherwise the first point would get
  // a month abbreviation and the last one would no longer be "today".
  const condensed = rawPoints.length > 120;
  if (condensed) rawPoints = onMonths(rawPoints);
  const downsampled = monthResolution || condensed;

  const now = k.uhr.datum();
  if (rawPoints.length <= 1) rawPoints = withStartPoint(rawPoints, period, purchaseTotal, now);

  if (!rawPoints.length) {
    return { currency, period, points: [], y_axis: [], period_change_pct: null, messpunkte: 0 };
  }

  const { points, y_axis, period_change_pct, chart } = buildChartData(rawPoints, currency, downsampled, now);

  return {
    currency,
    period,
    points,
    y_axis,
    period_change_pct,
    messpunkte,
    purchase_total: purchaseTotal.toFixed(2),
    chart,
  };
}
