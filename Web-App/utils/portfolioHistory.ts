import * as dbStandard from '../db/database';
import { getSetting as getSettingStandard } from './settings';
import { baueDiagrammdaten } from './portfolio/diagrammdaten';
import { rekonstruiereKurve } from './portfolio/kurve';
import { DEFAULT_PRICE_CONDITION } from './financeCalc';
/**
 * `db` und `getSetting` lassen sich hereingeben, damit die Rechnung ohne
 * Datenbank prüfbar bleibt; ohne Angabe gelten Datenbank und Einstellungen.
 */
async function getPortfolioHistory(
  viewerId: number, ids: number[], period: string,
  db: { all(sql: string, params?: any[]): Promise<any[]>; get(sql: string, params?: any[]): Promise<any> } = dbStandard,
  getSetting: (userId: number, key: string, fallback?: any) => Promise<any> = getSettingStandard,
) {
  // viewerId = wessen Einstellungen gelten, ids = wessen Daten gerechnet
  // werden. Steht der Kontofilter auf „Unterkonten", enthält ids das fragende
  // Konto gar nicht — die Währung dürfte dann nicht aus ids[0] kommen.
  const uids = Array.isArray(ids) ? ids.map(n => parseInt(String(n))) : [parseInt(String(ids))];
  const currency  = await getSetting(viewerId, 'currency', 'EUR');
  const condition = DEFAULT_PRICE_CONDITION;

  // Ein Set, EINE Zeile — auch wenn zwei Konten es besitzen. Mengen addiert,
  // Kaufpreis über alle Erfassungen des Haushalts gewichtet. Ohne die
  // Gruppierung käme dasselbe Set zweimal in die Summe.
  //
  // Der Rückfall `COALESCE(s.purchase_price,0) * s.quantity` ist mit Migration
  // 0032 weggefallen; COALESCE(a.total_price, 0) hält die Summe trotzdem
  // rechenbar, falls die Erfassungen eines Sets alle ohne Preis sind.
  const sets = await db.all(
    // Die Menge aus den Erfassungen (Migration 0036 hat s.quantity geloescht).
    // Sie steht in `a.total_qty` schon da — die Unterabfrage darunter gruppiert
    // genau danach. Der Rueckfall `COALESCE(a.total_qty, s.quantity)` ist damit
    // gegenstandslos: Ohne Erfassungen gibt es auch keine Menge.
    `SELECT s.set_number, COALESCE(SUM(a.total_qty), 0)::int AS quantity,
            SUM(COALESCE(a.total_price, 0))
              / NULLIF(SUM(a.total_qty), 0) AS purchase_price
     FROM sets s
     LEFT JOIN (
       SELECT user_id, set_number,
              SUM(COALESCE(purchase_price, 0) * quantity) AS total_price,
              SUM(quantity) AS total_qty
       FROM set_acquisitions GROUP BY user_id, set_number
     ) a ON a.user_id = s.user_id AND a.set_number = s.set_number
     WHERE s.user_id = ANY($1)
     GROUP BY s.set_number`, [uids]);
  if (!sets.length) {
    return { success:true, currency, period, points:[], y_axis:[], period_change_pct:null, messpunkte:0 };
  }

  const setNumbers    = sets.map((s: { set_number: string }) => s.set_number);
  const setQty        = Object.fromEntries(sets.map((s: any) => [s.set_number, s.quantity||1]));
  const placeholders  = setNumbers.map((_: unknown, i: number) => `$${i+3}`).join(',');
  const purchaseTotal = sets.reduce((s: number, r: any) => s + parseFloat(r.purchase_price||0)*(r.quantity||1), 0);

  // Date filter
  let dateFilter = '';
  if      (period==='week')  dateFilter = "AND recorded_at >= NOW() - INTERVAL '7 days'";
  else if (period==='month') dateFilter = "AND recorded_at >= NOW() - INTERVAL '30 days'";
  else if (period==='year')  dateFilter = "AND recorded_at >= NOW() - INTERVAL '365 days'";
  // max = no filter

  // Auflösung: IMMER pro Tag gruppieren (letzter Snapshot pro Tag).
  // Früher wurden year/max hart auf Monats-Buckets gruppiert (DISTINCT ON Monat,
  // letzter Snapshot). Bei wenig Daten kollabierte damit z.B. der ganze Juni zu
  // einem Punkt am 30.6. — Jahr/Max starteten später als Monat und zeigten eine
  // andere Veränderung. Jetzt wird täglich gruppiert und erst NACH dem Laden
  // adaptiv auf Monate verdichtet, wenn es wirklich zu viele Punkte sind
  // (> 120). Der erste Datenpunkt bleibt dabei immer exakt erhalten, sodass
  // Monat/Jahr/Max bei kurzer Historie identische Kurven zeigen.

  // Auflösung der Rekonstruktion (nicht des Schnappschuss-Wegs): Für Woche und
  // Monat je Tag, für Jahr und Max je MONAT.
  // Ausführlich: docs/begruendungen/utils/portfolioHistory.ts.md#getportfoliohistory-monatsaufloesung
  let monatsAufloesung = period === 'year' || period === 'max';
  let bucketExpr = monatsAufloesung ? "'YYYY-MM'" : "'YYYY-MM-DD'";

  // Die Kurve zeigt DEN HEUTIGEN BESTAND über die Zeit
  // Er hat recht, und der Fehler steckte in der Bedeutung der Kurve. Sie zeigte
  // „Wert dessen, was zu diesem Zeitpunkt erfasst WAR". Wer an einem Tag
  // vierundzwanzig Sets einträgt, sieht dort einen Sprung — und die Prozentzahl …
  // Ausführlich: docs/begruendungen/utils/portfolioHistory.ts.md#kurve


  // Die Rekonstruktion aus dem Preisverlauf steht in
  // utils/portfolio/kurve.ts — sie ist der Kern und mit Abstand der grösste
  // Teil dieser Funktion.
  const kurve = await rekonstruiereKurve({
    db, setNumbers, setQty, placeholders, dateFilter, bucketExpr,
    condition, currency, monatsAufloesung,
  });
  let rawPoints = kurve.rawPoints;
  monatsAufloesung = kurve.monatsAufloesung;
  const messpunkte = rawPoints.length;

  // Bei Monatsauflösung ist die Kurve bereits verdichtet — die Beschriftung
  // muss das wissen, sonst bekäme der erste Punkt ein Monatskürzel statt des
  // genauen Datums und der letzte nicht mehr „heute".
  let downsampled = monatsAufloesung;
  if (rawPoints.length > 120) {
    const byMonth = new Map();
    for (const p of rawPoints) {
      byMonth.set(p.month || p.day.slice(0,7), p); // letzter Punkt pro Monat gewinnt
    }
    const monthly = [...byMonth.values()].map(p => ({
      ...p, day: p.month || p.day.slice(0,7)
    }));
    // Ersten Original-Punkt exakt behalten (statt Monatsende des ersten Monats)
    const first = rawPoints[0];
    if (monthly.length && monthly[0].fullDay !== first.fullDay) {
      monthly[0] = { ...first, day: first.month || first.day.slice(0,7) };
    }
    rawPoints = monthly;
    downsampled = true;
  }

  // Ein einzelner Messpunkt bekommt einen künstlichen Startwert, damit die App
  // eine Linie hat; `messpunkte` sagt der Weboberfläche, dass das kein Verlauf ist.
  if (rawPoints.length <= 1) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2,'0');
    let startDate = new Date(now);
    if      (period==='week')  startDate.setDate(now.getDate()-7);
    else if (period==='month') startDate.setDate(now.getDate()-30);
    else if (period==='year')  startDate.setFullYear(now.getFullYear()-1);
    else                       startDate.setFullYear(now.getFullYear()-5);

    const baseVal = rawPoints.length===1 ? rawPoints[0].total
                  : purchaseTotal > 0   ? purchaseTotal : 0;

    if (baseVal > 0) {
      const startFullDay = `${startDate.getFullYear()}-${pad(startDate.getMonth()+1)}-${pad(startDate.getDate())}`;
      rawPoints = [{ day:startFullDay, fullDay:startFullDay, total:baseVal }, ...rawPoints];
    }
  }

  if (!rawPoints.length) {
    return { success:true, currency, period, points:[], y_axis:[], period_change_pct:null, messpunkte:0 };
  }

  // Achsen, Beschriftungen und Prozentänderung — reine Rechnung in
  // utils/portfolio/diagrammdaten.ts.
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

export { getPortfolioHistory };
