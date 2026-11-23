import type { FinancesContext } from '../context';

/** A point of the value curve; fullDay is the exact day of a monthly point. */
export interface CurvesPoint {
  day: string;
  fullDay: string;
  month?: string;
  total: number;
}
// From the global price history, which is why the curve is also correct retroactively.
export async function reconstructCurve(
  kx: FinancesContext,
  opts: {
    db?: FinancesContext['db'];
    setNumbers: string[];
    setQty: Record<string, number>;
    placeholders: string;
    dateFilter: string;
    bucketExpr: string;
    condition: string;
    currency: string;
    monthResolution: boolean;
  },
): Promise<{ rawPoints: CurvesPoint[]; monthResolution: boolean }> {
  const { setNumbers, setQty, placeholders, dateFilter, condition, currency } = opts;
  // `let`: when condensing to months, bucketExpr is switched along the way.
  let bucketExpr = opts.bucketExpr;
  let monthResolution = opts.monthResolution;
  let rawPoints: CurvesPoint[] = [];

  // Postgres calculates, with THE SAME rule as the valuation, not a similar one.
  {
    const quantities = setNumbers.map(sn => setQty[sn] || 1);
    const mainQuery = (bExpr: string) =>
      kx.portfolioCurve.dailyValuesFromHistory(
        currency,
        condition,
        setNumbers,
        quantities,
        dateFilter.replace(/recorded_at/g, 'ph.recorded_at'),
        bExpr,
      );

    let rows = await mainQuery(bucketExpr);
    // A single point at monthly resolution → days, so that all four periods
    // show the same change.
    if (monthResolution && rows.length < 2) {
      const dailyRows = await mainQuery("'YYYY-MM-DD'");
      if (dailyRows.length > rows.length) {
        rows = dailyRows;
        monthResolution = false;
        bucketExpr = "'YYYY-MM-DD'";
      }
    }
    // Last resort price_cache; one row per set, the detour via SQL is not worth it.
    if (!rows.length) {
      const raw = await kx.portfolioCurve.cachePricesTheSets(currency, condition, setNumbers, placeholders);
      const buckets: Record<string, { day: string; month: string; sets: Record<string, number> }> = {};
      for (const r of raw) {
        const k = r.day;
        buckets[k] ??= { day: r.day, month: r.month, sets: {} };
        const b = buckets[k];
        b.sets[r.set_number] = Number(r.market_price);
      }
      // Every set with its FIRST known price in the basket from the start, otherwise
      // the curve would start too low and report the collection's growth.
      const carry: Record<string, number> = {};
      for (const k of Object.keys(buckets).sort().reverse()) Object.assign(carry, buckets[k]?.sets);
      rows = Object.keys(buckets)
        .sort()
        .map(k => {
          const b = buckets[k]!;
          Object.assign(carry, b.sets);
          const total = Object.entries(carry).reduce((s, [sn, p]) => s + p * (setQty[sn] || 1), 0);
          return { day: b.day, month: b.month, total: total.toFixed(2) };
        });
    }
    rawPoints = rows
      .map(
        (r): CurvesPoint => ({
          day: r.day,
          fullDay: ('full_day' in r && r.full_day) || r.day,
          month: r.month,
          total: parseFloat(String(r.total)),
        }),
      )
      .filter(p => p.total > 0);

    // The first monthly bucket holds the value at the end of the month; without correction
    // the yearly curve would start higher than the monthly curve.
    const first = rawPoints[0];
    if (monthResolution && first) {
      const firstTag = (rows[0] && 'first_day' in rows[0] && rows[0].first_day) || first.fullDay;
      first.fullDay = firstTag;
      const start = await kx.portfolioCurve.lastValuesBeforeStart(
        currency,
        condition,
        setNumbers,
        quantities,
        firstTag,
        dateFilter.replace(/recorded_at/g, 'ph.recorded_at'),
      );
      const value = Number(start?.[0]?.total);
      if (Number.isFinite(value) && value > 0) first.total = value;
    }
  }

  return { rawPoints, monthResolution };
}
