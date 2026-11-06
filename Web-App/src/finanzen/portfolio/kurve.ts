import { meldeUndLiefere } from '../../infra/fehler';
import * as repo from '../repository/portfolioKurve';

/** Ein Punkt der Wertkurve; fullDay ist der genaue Tag eines Monatspunkts. */
export interface KurvenPunkt { day: string; fullDay: string; month?: string; total: number }
// Ausführlich: docs/begruendungen/src/finanzen/portfolio/kurve.ts.md#rekonstruierekurve
export async function rekonstruiereKurve(opts: {
  db?: unknown;
  setNumbers: string[];
  setQty: Record<string, number>;
  placeholders: string;
  dateFilter: string;
  bucketExpr: string;
  condition: string;
  currency: string;
  monatsAufloesung: boolean;
}): Promise<{ rawPoints: KurvenPunkt[]; monatsAufloesung: boolean }> {
  const { setNumbers, setQty, placeholders, dateFilter, condition, currency } = opts;
  // `let`: Bei Verdichtung auf Monate wird bucketExpr unterwegs umgestellt.
  let bucketExpr = opts.bucketExpr;
  let monatsAufloesung = opts.monatsAufloesung;
  let rawPoints: KurvenPunkt[] = [];

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
    const buckets: Record<string, { day: string; month: string; sets: Record<string, number> }> = {};
    for (const r of roh) {
      const k = r.day;
      const b = buckets[k] ??= { day: r.day, month: r.month, sets: {} };
      const p = Number(r.avg_price ?? 0) || Number(r.qty_avg_price ?? 0);
      if (p > 0) b.sets[r.set_number] = p;
    }
    // Jedes Set mit seinem ERSTEN bekannten Preis von Anfang an im Korb, sonst
    // begänne die Kurve zu tief und meldete den Zuwachs der Sammlung.
    const carry: Record<string, number> = {};
    for (const k of Object.keys(buckets).sort().reverse())
      Object.assign(carry, buckets[k]?.sets);
    rows = Object.keys(buckets).sort().map(k => {
      const b = buckets[k]!;
      Object.assign(carry, b.sets);
      const total = Object.entries(carry).reduce((s,[sn,p]) => s+p*(setQty[sn]||1), 0);
      return { day: b.day, month: b.month, total: total.toFixed(2) };
    });
  }
  rawPoints = rows
    .map((r): KurvenPunkt => ({ day: r.day, fullDay: ('full_day' in r && r.full_day) || r.day, month: r.month, total: parseFloat(String(r.total)) }))
    .filter(p => p.total > 0);

  // Im ersten Monatsbucket steht der Wert am Monatsende; ohne Korrektur begänne
  // die Jahreskurve höher als die Monatskurve.
  const erster = rawPoints[0];
  if (monatsAufloesung && erster) {
    const ersterTag = (rows[0] && 'first_day' in rows[0] && rows[0].first_day) || erster.fullDay;
    erster.fullDay = ersterTag;
    const start = await repo.letzteWerteVorBeginn(currency, condition, setNumbers, mengen, ersterTag, dateFilter.replace(/recorded_at/g, 'ph.recorded_at')).catch(meldeUndLiefere('portfolio:kurve rechnen', []));
    const wert = Number(start?.[0]?.total);
    if (Number.isFinite(wert) && wert > 0) erster.total = wert;
  }
}

  return { rawPoints, monatsAufloesung };
}
