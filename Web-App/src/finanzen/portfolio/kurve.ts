import type { FinanzenKontext } from '../kontext';

/** Ein Punkt der Wertkurve; fullDay ist der genaue Tag eines Monatspunkts. */
export interface KurvenPunkt {
  day: string;
  fullDay: string;
  month?: string;
  total: number;
}
// Aus dem globalen Preisverlauf, darum stimmt die Kurve auch rückwirkend.
export async function rekonstruiereKurve(
  kx: FinanzenKontext,
  opts: {
    db?: unknown;
    setNumbers: string[];
    setQty: Record<string, number>;
    placeholders: string;
    dateFilter: string;
    bucketExpr: string;
    condition: string;
    currency: string;
    monatsAufloesung: boolean;
  },
): Promise<{ rawPoints: KurvenPunkt[]; monatsAufloesung: boolean }> {
  const { setNumbers, setQty, placeholders, dateFilter, condition, currency } = opts;
  // `let`: Bei Verdichtung auf Monate wird bucketExpr unterwegs umgestellt.
  let bucketExpr = opts.bucketExpr;
  let monatsAufloesung = opts.monatsAufloesung;
  let rawPoints: KurvenPunkt[] = [];

  // Postgres rechnet, mit DERSELBEN Regel wie die Bewertung, nicht einer ähnlichen.
  {
    const mengen = setNumbers.map(sn => setQty[sn] || 1);
    const hauptAbfrage = (bExpr: string) =>
      kx.portfolioKurve.tageswerteAusVerlauf(
        currency,
        condition,
        setNumbers,
        mengen,
        dateFilter.replace(/recorded_at/g, 'ph.recorded_at'),
        bExpr,
      );

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
      const roh = await kx.portfolioKurve.cachePreiseDerSets(currency, condition, setNumbers, placeholders);
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
        (r): KurvenPunkt => ({
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
    if (monatsAufloesung && erster) {
      const ersterTag = (rows[0] && 'first_day' in rows[0] && rows[0].first_day) || erster.fullDay;
      erster.fullDay = ersterTag;
      const start = await kx.portfolioKurve.letzteWerteVorBeginn(
        currency,
        condition,
        setNumbers,
        mengen,
        ersterTag,
        dateFilter.replace(/recorded_at/g, 'ph.recorded_at'),
      );
      const wert = Number(start?.[0]?.total);
      if (Number.isFinite(wert) && wert > 0) erster.total = wert;
    }
  }

  return { rawPoints, monatsAufloesung };
}
