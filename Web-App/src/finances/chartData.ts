/** One shape for all history endpoints, so that both UIs need one
 * chart builder. */
import { marketPriceFrom } from '../catalog';

export interface ChartPoint {
  x: string;
  y: number;
}

/** One measurement: day and price (rule: marketPriceFrom). */
export interface Messung {
  recorded_at: unknown;
  avg_price?: number | string | null;
  qty_avg_price?: number | string | null;
}

export interface ChartSeries {
  name: string;
  values: ChartPoint[];
  /** Index of the first real value; padded zeros come before it. */
  firstRealIndex: number;
}

/** @param inputs Per series a name and the raw rows (recorded_at, avg_price). */
export function buildChart(inputs: Array<{ name: string; rows: Messung[] }>) {
  const valueFor = (r: Messung) => marketPriceFrom(r) ?? 0;

  // Only days on which a series has a value: the axis shows measurement points,
  // not every calendar day.
  const x = [...new Set(inputs.flatMap(s => (s.rows || []).map(r => String(r.recorded_at))))].sort();

  const values: ChartSeries[] = inputs.map(s => {
    const byDay = new Map<string, number>();
    for (const r of s.rows || []) byDay.set(String(r.recorded_at), valueFor(r));
    const pts = x.map(day => ({ x: day, y: byDay.has(day) ? byDay.get(day)! : 0 }));
    const firstRealIndex = pts.findIndex(p => byDay.has(p.x));
    return { name: s.name, values: pts, firstRealIndex: firstRealIndex < 0 ? pts.length : firstRealIndex };
  });

  return { values, x };
}
