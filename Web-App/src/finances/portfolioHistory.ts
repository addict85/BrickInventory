import type { Sicht } from '../household';
import { buildChartData } from './portfolio/chartData';
import { reconstructCurve, type CurvesPoint } from './portfolio/curve';
import { DEFAULT_PRICE_CONDITION } from './financeCalc';
import type { FinancesContext } from './context';
/** Je Monat der letzte Punkt; der erste bleibt exakt, damit alle Zeiträume beim selben Start beginnen. */
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

/** Ein künstlicher Startwert, damit die App eine Linie hat; `messpunkte` sagt der Weboberfläche, dass das kein Verlauf ist. */
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

/** `db` und `getSetting` lassen sich hereingeben, damit die Rechnung ohne
 * Datenbank prüfbar bleibt. */
export async function portfolioVerlauf(
  k: FinancesContext,
  viewerId: number,
  idsChoice: Sicht | number[],
  period: string,
  db: unknown = k.db,
  getSetting: (userId: number, key: string, fallback: string) => Promise<string> = k.einstellungen.userValue,
) {
  const ids = await k.household.scopeFrom(idsChoice);
  // Mit dem Filter „Unterkonten" enthält ids das fragende Konto nicht; die
  // Währung darf dann nicht aus ids[0] kommen.
  const uids = Array.isArray(ids) ? ids.map(n => parseInt(String(n), 10)) : [parseInt(String(ids), 10)];
  const currency = await getSetting(viewerId, 'currency', 'EUR');
  const condition = DEFAULT_PRICE_CONDITION;

  // Ein Set, EINE Zeile, auch bei zwei Besitzern — sonst käme es zweimal in die Summe.
  const sets = await k.portfolioKurve.setsWithPurchaseTotal(uids);
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

  // Für Woche und Monat je Tag, für Jahr und Max je MONAT.
  let monthResolution = period === 'year' || period === 'max';
  const bucketExpr = monthResolution ? "'YYYY-MM'" : "'YYYY-MM-DD'";

  // Die Kurve zeigt den HEUTIGEN Bestand über die Zeit: Sonst erschiene jedes
  // Erfassen als Kurssprung.

  const kurve = await reconstructCurve(k, {
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
  let rawPoints = kurve.rawPoints;
  monthResolution = kurve.monthResolution;
  const messpunkte = rawPoints.length;

  // Die Beschriftung muss die Verdichtung kennen, sonst bekäme der erste Punkt
  // ein Monatskürzel und der letzte nicht mehr „heute".
  const verdichtet = rawPoints.length > 120;
  if (verdichtet) rawPoints = onMonths(rawPoints);
  const downsampled = monthResolution || verdichtet;

  const jetzt = k.uhr.datum();
  if (rawPoints.length <= 1) rawPoints = withStartPoint(rawPoints, period, purchaseTotal, jetzt);

  if (!rawPoints.length) {
    return { currency, period, points: [], y_axis: [], period_change_pct: null, messpunkte: 0 };
  }

  const { points, y_axis, period_change_pct, chart } = buildChartData(rawPoints, currency, downsampled, jetzt);

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
