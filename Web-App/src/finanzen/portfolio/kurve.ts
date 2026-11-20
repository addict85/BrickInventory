import type { FinancesContext } from '../kontext';

/** Ein Punkt der Wertkurve; fullDay ist der genaue Tag eines Monatspunkts. */
export interface CurvesPoint {
  day: string;
  fullDay: string;
  month?: string;
  total: number;
}
// Aus dem globalen Preisverlauf, darum stimmt die Kurve auch rückwirkend.
export async function reconstructCurve(
  kx: FinancesContext,
  opts: {
    db?: unknown;
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
  // `let`: Bei Verdichtung auf Monate wird bucketExpr unterwegs umgestellt.
  let bucketExpr = opts.bucketExpr;
  let monthResolution = opts.monthResolution;
  let rawPoints: CurvesPoint[] = [];

  // Postgres rechnet, mit DERSELBEN Regel wie die Bewertung, nicht einer ähnlichen.
  {
    const mengen = setNumbers.map(sn => setQty[sn] || 1);
    const mainQuery = (bExpr: string) =>
      kx.portfolioKurve.dailyValuesFromHistory(
        currency,
        condition,
        setNumbers,
        mengen,
        dateFilter.replace(/recorded_at/g, 'ph.recorded_at'),
        bExpr,
      );

    let rows = await mainQuery(bucketExpr);
    // Ein einziger Punkt bei Monatsauflösung → Tage, damit alle vier Zeiträume
    // dieselbe Veränderung zeigen.
    if (monthResolution && rows.length < 2) {
      const dailyRows = await mainQuery("'YYYY-MM-DD'");
      if (dailyRows.length > rows.length) {
        rows = dailyRows;
        monthResolution = false;
        bucketExpr = "'YYYY-MM-DD'";
      }
    }
    // Letzte Zuflucht price_cache; eine Zeile je Set, der Umweg über SQL lohnt nicht.
    if (!rows.length) {
      const roh = await kx.portfolioKurve.cachePricesTheSets(currency, condition, setNumbers, placeholders);
      const buckets: Record<string, { day: string; month: string; sets: Record<string, number> }> = {};
      for (const r of roh) {
        const k = r.day;
        buckets[k] ??= { day: r.day, month: r.month, sets: {} };
        const b = buckets[k];
        b.sets[r.set_number] = Number(r.marktpreis);
      }
      // Jedes Set mit seinem ERSTEN bekannten Preis von Anfang an im Korb, sonst
      // begänne die Kurve zu tief und meldete den Zuwachs der Sammlung.
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

    // Im ersten Monatsbucket steht der Wert am Monatsende; ohne Korrektur begänne
    // die Jahreskurve höher als die Monatskurve.
    const erster = rawPoints[0];
    if (monthResolution && erster) {
      const firstTag = (rows[0] && 'first_day' in rows[0] && rows[0].first_day) || erster.fullDay;
      erster.fullDay = firstTag;
      const start = await kx.portfolioKurve.lastValuesBeforeStart(
        currency,
        condition,
        setNumbers,
        mengen,
        firstTag,
        dateFilter.replace(/recorded_at/g, 'ph.recorded_at'),
      );
      const wert = Number(start?.[0]?.total);
      if (Number.isFinite(wert) && wert > 0) erster.total = wert;
    }
  }

  return { rawPoints, monthResolution };
}
