import { meldeUndLiefere } from '../../infra/httpError';
import * as repo from '../repository/portfolioKurve';
/**
 * Die Kurve aus dem PREISVERLAUF je Set rekonstruieren.
 * Ausführlich: docs/begruendungen/src/finanzen/portfolio/kurve.ts.md#rekonstruierekurve
 */
export async function rekonstruiereKurve(opts: {
  db: any;
  setNumbers: string[];
  setQty: Record<string, number>;
  placeholders: string;
  dateFilter: string;
  bucketExpr: string;
  condition: string;
  currency: string;
  monatsAufloesung: boolean;
}): Promise<{ rawPoints: any[]; monatsAufloesung: boolean }> {
  const { setNumbers, setQty, placeholders, dateFilter, condition, currency } = opts;
  // bucketExpr wird unterwegs umgestellt, wenn die Kurve auf Monate verdichtet
  // wird — deshalb `let` statt Destrukturierung.
  let bucketExpr = opts.bucketExpr;
  let monatsAufloesung = opts.monatsAufloesung;
  let rawPoints: any[] = []; // [{day, total}]

// Kurve aus dem Preisverlauf JE SET rekonstruieren
// Jetzt rechnet Postgres, und zwar mit DERSELBEN Regel, nicht mit einer
// ähnlichen:
// Ausführlich: docs/begruendungen/src/finanzen/portfolio/kurve.ts.md#abschnitt
{
  const mengen = setNumbers.map(sn => setQty[sn] || 1);
  const hauptAbfrage = (bExpr: string) => repo.tageswerteAusVerlauf(currency, condition, setNumbers, mengen, dateFilter.replace(/recorded_at/g, 'ph.recorded_at'), bExpr);

  let rows = await hauptAbfrage(bucketExpr);
  // Ein einziger Punkt bei Monatsauflösung → auf Tage zurückschalten, damit
  // alle vier Zeiträume dieselbe Veränderung zeigen (siehe oben).
  if (monatsAufloesung && rows.length < 2) {
    const tagesRows = await hauptAbfrage("'YYYY-MM-DD'");
    if (tagesRows.length > rows.length) {
      rows = tagesRows;
      monatsAufloesung = false;
      bucketExpr = "'YYYY-MM-DD'";
    }
  }
  // Letzte Zuflucht: price_cache (eine Zeile je Set — hier lohnt der
  // Umweg über SQL nicht, die Menge ist klein).
  if (!rows.length) {
    const roh = await repo.cachePreiseDerSets(currency, condition, setNumbers, placeholders);
    const buckets: any = {};
    for (const r of roh) {
      const k = r.day;
      if (!buckets[k]) buckets[k] = { day: r.day, month: r.month, sets: {} };
      const p = parseFloat(r.avg_price||0) || parseFloat(r.qty_avg_price||0);
      if (p > 0) buckets[k].sets[r.set_number] = p;
    }
    // Dieselbe Rückschreibung wie oben: Jedes Set steht mit seinem ERSTEN
    // bekannten Preis von Anfang an im Korb. Ohne das begänne die Kurve auch
    // hier zu tief und die Prozentzahl meldete den Zuwachs der Sammlung.
    const carry: any = {};
    for (const k of Object.keys(buckets).sort().reverse())
      Object.assign(carry, buckets[k].sets);
    rows = Object.keys(buckets).sort().map(k => {
      const b = buckets[k];
      Object.assign(carry, b.sets);
      const total = Object.entries(carry).reduce((s,[sn,p]) => s+(p as number)*(setQty[sn]||1), 0);
      return { day: b.day, month: b.month, total: total.toFixed(2) };
    });
  }
  rawPoints = rows
    .map((r: any) => ({ day: r.day, fullDay: r.full_day || r.day, month: r.month, total: parseFloat(r.total) }))
    .filter((p: any) => p.total > 0);

  // Ersten Punkt exakt halten.
  //
  // Bei Monatsauflösung steht im ersten Bucket der Wert am MONATSENDE. Die
  // alte Fassung zeigte dort den Wert am ersten Tag MIT Daten — sie behielt
  // den ersten Tagespunkt beim Verdichten ausdrücklich bei, damit Monat,
  // Jahr und Max beim selben Startwert beginnen. Ohne diese Korrektur
  // begänne die Jahreskurve höher als die Monatskurve, sobald im ersten
  // Monat noch Sets dazukommen.
  if (monatsAufloesung && rawPoints.length) {
    // Der ERSTE Tag mit Daten im ersten Monat, nicht der letzte: Die alte
    // Fassung startete die Kurve genau dort.
    const ersterTag = rows[0]?.first_day || rawPoints[0].fullDay;
    rawPoints[0].fullDay = ersterTag;
    const start = await repo.letzteWerteVorBeginn(currency, condition, setNumbers, mengen, ersterTag, dateFilter.replace(/recorded_at/g, 'ph.recorded_at')).catch(meldeUndLiefere('portfolio:kurve rechnen', []));
    const wert = parseFloat(start?.[0]?.total);
    if (Number.isFinite(wert) && wert > 0) rawPoints[0].total = wert;
  }
}

// Adaptive Verdichtung: erst wenn die Tagesauflösung zu viele Punkte liefert
// (> 120, also gut 4 Monate Historie), auf einen Punkt pro Monat reduzieren
// (jeweils der letzte Tages-Snapshot des Monats). Der allererste Punkt bleibt
// dabei immer exakt erhalten, damit Startdatum und Veränderung über alle
// Zeiträume konsistent sind.
  return { rawPoints, monatsAufloesung };
}
