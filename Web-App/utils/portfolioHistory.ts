import { baueDiagrammdaten } from './portfolio/diagrammdaten';
import { rekonstruiereKurve } from './portfolio/kurve';
import { DEFAULT_PRICE_CONDITION } from './financeCalc';
/**
 * `db` und `getSetting` kommen HEREIN statt importiert zu werden — die Datei
 * war so schon vor dieser Aenderung ohne Datenbank pruefbar. Der Typ schreibt
 * den Ausschnitt aus, der tatsaechlich benutzt wird.
 */
async function getPortfolioHistory(
  viewerId: number, ids: number[], period: string,
  db: { all(sql: string, params?: any[]): Promise<any[]>; get(sql: string, params?: any[]): Promise<any> },
  getSetting: (userId: number, key: string, fallback?: any) => Promise<any>,
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
  const sets = await db.all(
    `SELECT s.set_number, SUM(s.quantity)::int AS quantity,
            SUM(COALESCE(a.total_price, COALESCE(s.purchase_price,0) * s.quantity))
              / NULLIF(SUM(COALESCE(a.total_qty, s.quantity)), 0) AS purchase_price
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
    return { success:true, currency, period, points:[], y_axis:[], period_change_pct:null };
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
  //
  // Das ist keine Sparmassnahme an der Anzeige — die Verdichtung auf Monate
  // passierte ohnehin, nur eben erst NACH dem Laden aller Tageswerte. Jetzt
  // gruppiert Postgres gleich richtig: Bei 800 Sets und einem Jahr Historie
  // fällt der Fensterlauf von 292 000 auf 9 600 Zeilen.
  //
  // Gemessen (800 Sets, 292 000 Zeilen, Haushalt mit zwei Konten, Zeitraum
  // Max): vorher 1 741 ms und 34 MB Heap, jetzt 931 ms und praktisch kein
  // zusätzlicher Heap (802 ms Hauptabfrage, 129 ms Startpunkt-Korrektur). Der
  // Gewinn liegt vor allem im Speicher: Die Zeilen bleiben in der Datenbank.
  //
  // ── Ausnahme: kurze Historie ─────────────────────────────────────────────
  // Passt der ganze Verlauf in EINEN Monat, ergibt die Monatsauflösung genau
  // einen Punkt. Daraus lässt sich keine Veränderung ablesen — „Jahr" und
  // „Max" zeigten dann 0 %, während „Woche" dieselben Daten mit +102 %
  // auswies. Dieselbe Sammlung, vier Knöpfe, zwei Antworten. In dem Fall wird
  // unten auf Tagesauflösung zurückgeschaltet; teuer ist das gerade dort
  // nicht, wo es nur wenige Tage gibt.
  let monatsAufloesung = period === 'year' || period === 'max';
  let bucketExpr = monatsAufloesung ? "'YYYY-MM'" : "'YYYY-MM-DD'";

  // ── Die Kurve zeigt DEN HEUTIGEN BESTAND über die Zeit ───────────────────
  //
  // ── Marcos Befund ────────────────────────────────────────────────────────
  // „Neu hinzugefügte Sets sollen nicht dazu führen, dass sich der %-Wert
  // ändert. Die +850.2% sind offensichtlich nicht korrekt."
  //
  // Er hat recht, und der Fehler steckte in der Bedeutung der Kurve. Sie zeigte
  // „Wert dessen, was zu diesem Zeitpunkt erfasst WAR". Wer an einem Tag
  // vierundzwanzig Sets einträgt, sieht dort einen Sprung — und die Prozentzahl
  // daneben, die den ersten Punkt mit dem letzten vergleicht, meldet den
  // Zuwachs der SAMMLUNG als Wertentwicklung. Nachgestellt (2 Sets seit einer
  // Woche, 24 gestern dazu, Preise leicht FALLEND): +264 %.
  //
  // Jetzt zeigt sie „was der heutige Bestand über die Zeit wert gewesen wäre".
  // Ein Set, dessen Preisverlauf erst später beginnt, wird mit seinem ERSTEN
  // bekannten Preis zurückgeschrieben — es steht damit von Anfang an im Korb
  // und trägt zur Veränderung genau nichts bei, bis sich sein Preis wirklich
  // bewegt. Das ist die einzige Lesart, in der die Prozentzahl etwas über
  // Wertentwicklung aussagt statt über Kaufverhalten.
  //
  // ── Warum die Schnappschüsse dafür nicht taugen ──────────────────────────
  // Der Preis-Job legte je Konto und Tag einen Gesamtwert unter dem Pseudo-Set
  // unter einem Pseudo-Set ab, und für ein einzelnes Konto las die Kurve daraus.
  // Ein solcher Schnappschuss hält fest, was AN JENEM TAG erfasst war — die
  // Frage „was wäre der heutige Bestand damals wert gewesen" lässt sich daraus
  // grundsätzlich nicht beantworten. Es war ausserdem eine ZWEITE Fassung
  // derselben Kurve: Ein einzelnes Konto bekam eine anders gerechnete Linie als
  // ein Haushalt, und beim Wechsel des Kontofilters sprang die Form.
  //
  // Der Weg darunter rekonstruiert je Set aus dem Preisverlauf. Der ist nicht
  // kontogebunden, sondern global — die Kurve entsteht damit RÜCKWIRKEND und
  // stimmt auch für die Zeit vor einer Haushaltsverknüpfung.


  // Die Rekonstruktion aus dem Preisverlauf steht seit Nachtrag 135 in
  // utils/portfolio/kurve.ts — sie ist der Kern und mit Abstand der grösste
  // Teil dieser Funktion.
  const kurve = await rekonstruiereKurve({
    db, setNumbers, setQty, placeholders, dateFilter, bucketExpr,
    condition, currency, monatsAufloesung,
  });
  let rawPoints = kurve.rawPoints;
  monatsAufloesung = kurve.monatsAufloesung;

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

  // Prepend synthetic start baseline if only 1 real point
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
    return { success:true, currency, period, points:[], y_axis:[], period_change_pct:null };
  }

  // Achsen, Beschriftungen und Prozentänderung — reine Rechnung, seit
  // Nachtrag 135 in utils/portfolio/diagrammdaten.ts.
  const { points, y_axis, period_change_pct, chart } = baueDiagrammdaten(rawPoints, currency, downsampled);

  return {
    success:           true,
    currency,
    period,
    points,
    y_axis,
    period_change_pct,
    purchase_total:    purchaseTotal.toFixed(2),
    chart,
  };
}

export { getPortfolioHistory };
