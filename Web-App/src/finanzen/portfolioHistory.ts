import { blickfeldAus } from '../haushalt/haushalt';
import type { Sicht } from '../haushalt/haushalt';
import * as dbStandard from '../../db/database';
import { getSetting as getSettingStandard } from '../einstellungen/settings';
import { baueDiagrammdaten } from './portfolio/diagrammdaten';
import { rekonstruiereKurve, type KurvenPunkt } from './portfolio/kurve';
import { DEFAULT_PRICE_CONDITION } from './financeCalc';
import * as repo from './repository/portfolioKurve';
/** Je Monat der letzte Punkt; der erste bleibt exakt, damit alle Zeiträume beim selben Start beginnen. */
function aufMonate(rawPoints: KurvenPunkt[]): KurvenPunkt[] {
  const byMonth = new Map<string, KurvenPunkt>();
  for (const p of rawPoints) byMonth.set(p.month || p.day.slice(0,7), p);
  const monthly = [...byMonth.values()].map(p => ({ ...p, day: p.month || p.day.slice(0,7) }));
  const first = rawPoints[0];
  if (first && monthly[0] && monthly[0].fullDay !== first.fullDay) {
    monthly[0] = { ...first, day: first.month || first.day.slice(0,7) };
  }
  return monthly;
}

/** Ein künstlicher Startwert, damit die App eine Linie hat; `messpunkte` sagt der Weboberfläche, dass das kein Verlauf ist. */
function mitStartpunkt(rawPoints: KurvenPunkt[], period: string, purchaseTotal: number): KurvenPunkt[] {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2,'0');
  const startDate = new Date(now);
  if      (period==='week')  startDate.setDate(now.getDate()-7);
  else if (period==='month') startDate.setDate(now.getDate()-30);
  else if (period==='year')  startDate.setFullYear(now.getFullYear()-1);
  else                       startDate.setFullYear(now.getFullYear()-5);
  const baseVal = rawPoints[0] ? rawPoints[0].total : purchaseTotal > 0 ? purchaseTotal : 0;
  if (!(baseVal > 0)) return rawPoints;
  const startFullDay = `${startDate.getFullYear()}-${pad(startDate.getMonth()+1)}-${pad(startDate.getDate())}`;
  return [{ day:startFullDay, fullDay:startFullDay, total:baseVal }, ...rawPoints];
}

/** `db` und `getSetting` lassen sich hereingeben, damit die Rechnung ohne
 * Datenbank prüfbar bleibt. */
export async function getPortfolioHistory(
  viewerId: number, idsWahl: Sicht | number[], period: string,
  db: unknown = dbStandard,
  getSetting: (userId: number, key: string, fallback: string) => Promise<string> = getSettingStandard,
) {
  const ids = await blickfeldAus(idsWahl);
  // Mit dem Filter „Unterkonten" enthält ids das fragende Konto nicht; die
  // Währung darf dann nicht aus ids[0] kommen.
  const uids = Array.isArray(ids) ? ids.map(n => parseInt(String(n))) : [parseInt(String(ids))];
  const currency  = await getSetting(viewerId, 'currency', 'EUR');
  const condition = DEFAULT_PRICE_CONDITION;

  // Ein Set, EINE Zeile, auch bei zwei Besitzern — sonst käme es zweimal in die Summe.
  const sets = await repo.setsMitKaufsumme(uids);
  if (!sets.length) {
    return { success:true, currency, period, points:[], y_axis:[], period_change_pct:null, messpunkte:0 };
  }

  const setNumbers    = sets.map((s: { set_number: string }) => s.set_number);
  const setQty        = Object.fromEntries(sets.map(s => [s.set_number, s.quantity||1]));
  const placeholders  = setNumbers.map((_: unknown, i: number) => `$${i+3}`).join(',');
  const purchaseTotal = sets.reduce((s: number, r) => s + (Number(r.purchase_price) || 0)*(r.quantity||1), 0);

  let dateFilter = '';
  if      (period==='week')  dateFilter = "AND recorded_at >= NOW() - INTERVAL '7 days'";
  else if (period==='month') dateFilter = "AND recorded_at >= NOW() - INTERVAL '30 days'";
  else if (period==='year')  dateFilter = "AND recorded_at >= NOW() - INTERVAL '365 days'";

  // Für Woche und Monat je Tag, für Jahr und Max je MONAT.
  // Ausführlich: docs/begruendungen/src/finanzen/portfolioHistory.ts.md#getportfoliohistory-monatsaufloesung
  let monatsAufloesung = period === 'year' || period === 'max';
  let bucketExpr = monatsAufloesung ? "'YYYY-MM'" : "'YYYY-MM-DD'";

  // Die Kurve zeigt den HEUTIGEN Bestand über die Zeit: Sonst erschiene jedes
  // Erfassen als Kurssprung.
  // Ausführlich: docs/begruendungen/src/finanzen/portfolioHistory.ts.md#kurve

  const kurve = await rekonstruiereKurve({
    db, setNumbers, setQty, placeholders, dateFilter, bucketExpr,
    condition, currency, monatsAufloesung,
  });
  let rawPoints = kurve.rawPoints;
  monatsAufloesung = kurve.monatsAufloesung;
  const messpunkte = rawPoints.length;

  // Die Beschriftung muss die Verdichtung kennen, sonst bekäme der erste Punkt
  // ein Monatskürzel und der letzte nicht mehr „heute".
  const verdichtet = rawPoints.length > 120;
  if (verdichtet) rawPoints = aufMonate(rawPoints);
  const downsampled = monatsAufloesung || verdichtet;

  if (rawPoints.length <= 1) rawPoints = mitStartpunkt(rawPoints, period, purchaseTotal);

  if (!rawPoints.length) {
    return { success:true, currency, period, points:[], y_axis:[], period_change_pct:null, messpunkte:0 };
  }

  const { points, y_axis, period_change_pct, chart } = baueDiagrammdaten(rawPoints, currency, downsampled);

  return {
    success:           true,
    currency,
    period,
    points,
    y_axis,
    period_change_pct,
    messpunkte,
    purchase_total:    purchaseTotal.toFixed(2),
    chart,
  };
}

