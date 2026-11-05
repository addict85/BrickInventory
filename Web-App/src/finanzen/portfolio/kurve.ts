import { meldeUndLiefere } from '../../infra/fehler';
import * as repo from '../repository/portfolioKurve';
// Ausführlich: docs/begruendungen/src/finanzen/portfolio/kurve.ts.md#rekonstruierekurve
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
  // `let`: Bei Verdichtung auf Monate wird bucketExpr unterwegs umgestellt.
  let bucketExpr = opts.bucketExpr;
  let monatsAufloesung = opts.monatsAufloesung;
  let rawPoints: any[] = []; // [{day, total}]

// Postgres rechnet, mit DERSELBEN Regel wie die Bewertung, nicht einer ähnlichen.
// Ausführlich: docs/begruendungen/src/finanzen/portfolio/kurve.ts.md#abschnitt
{
  const mengen = setNumbers.map(sn => setQty[sn] || 1);
  const hauptAbfrage = (bExpr: string) => repo.tageswerteAusVerlauf(currency, condition, setNumbers, mengen, dateFilter.replace(/recorded_at/g, 'ph.recorded_at'), bExpr);

  let rows = await hauptAbfrage(bucketExpr);
  // Ein einziger Punkt bei Monatsauflösung → Tage, damit alle vier Zeiträume
  // dieselbe Veränderung zeigen.
  if (monatsAufloesung && rows.length < 2) {
    const tagesRows = await hauptAbfrage("'YYYY-MM-DD'");
    if (tagesRows.length > rows.length) {
      rows = tagesRows;
      monatsAufloesung = false;
      bucketExpr = "'YYYY-MM-DD'";
    }
  }
  // Letzte Zuflucht price_cache; eine Zeile je Set, der Umweg über SQL lohnt nicht.
  if (!rows.length) {
    const roh = await repo.cachePreiseDerSets(currency, condition, setNumbers, placeholders);
    const buckets: any = {};
    for (const r of roh) {
      const k = r.day;
      if (!buckets[k]) buckets[k] = { day: r.day, month: r.month, sets: {} };
      const p = parseFloat(r.avg_price||0) || parseFloat(r.qty_avg_price||0);
      if (p > 0) buckets[k].sets[r.set_number] = p;
    }
    // Jedes Set mit seinem ERSTEN bekannten Preis von Anfang an im Korb, sonst
    // begänne die Kurve zu tief und meldete den Zuwachs der Sammlung.
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

  // Im ersten Monatsbucket steht der Wert am Monatsende; ohne Korrektur begänne
  // die Jahreskurve höher als die Monatskurve.
  if (monatsAufloesung && rawPoints.length) {
    const ersterTag = rows[0]?.first_day || rawPoints[0].fullDay;
    rawPoints[0].fullDay = ersterTag;
    const start = await repo.letzteWerteVorBeginn(currency, condition, setNumbers, mengen, ersterTag, dateFilter.replace(/recorded_at/g, 'ph.recorded_at')).catch(meldeUndLiefere('portfolio:kurve rechnen', []));
    const wert = parseFloat(start?.[0]?.total);
    if (Number.isFinite(wert) && wert > 0) rawPoints[0].total = wert;
  }
}

  return { rawPoints, monatsAufloesung };
}
