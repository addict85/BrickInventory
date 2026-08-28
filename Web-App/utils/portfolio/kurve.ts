/**
 * Die Kurve aus dem PREISVERLAUF je Set rekonstruieren.
 *
 * ── Warum dieser Weg (unverändert aus getPortfolioHistory) ──────────────────
 * Der Preisverlauf ist nicht kontogebunden, sondern global. Die Kurve entsteht
 * damit RÜCKWIRKEND und stimmt auch für die Zeit vor einer Haushaltsverknüpfung
 * — anders als die Schnappschüsse, die es nur ab dem Zeitpunkt gibt, an dem sie
 * geschrieben wurden.
 *
 * ── Warum eigene Datei (Nachtrag 135) ───────────────────────────────────────
 * Das ist der Kern von getPortfolioHistory() und mit Abstand sein grösster
 * Teil. Danebenzustehen hatte einen Preis: Wer einen Fehler in der
 * Achsenbeschriftung suchte, las erst durch zweihundert Zeilen
 * SQL-Rekonstruktion.
 *
 * Gibt zurück, was die Rechnung darüber braucht: die Rohpunkte und — falls die
 * Auflösung unterwegs auf Monate umgestellt wurde — den geänderten Wert.
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
  const { db, setNumbers, setQty, placeholders, dateFilter, condition, currency } = opts;
  // bucketExpr wird unterwegs umgestellt, wenn die Kurve auf Monate verdichtet
  // wird — deshalb `let` statt Destrukturierung.
  let bucketExpr = opts.bucketExpr;
  let monatsAufloesung = opts.monatsAufloesung;
  let rawPoints: any[] = []; // [{day, total}]

// ── Kurve aus dem Preisverlauf JE SET rekonstruieren ──────────────────────
//
// VORHER lud diese Stelle JEDE price_history-Zeile aller Sets in den
// Node-Prozess und gruppierte sie in JavaScript. Gemessen mit 800 Sets und
// einem Jahr Tageswerten (292 000 Zeilen): 1,2 bis 1,7 Sekunden und 35 bis
// 42 MB Heap — für dreizehn Punkte im Diagramm, bei jedem Aufruf.
//
// Jetzt rechnet Postgres, und zwar mit DERSELBEN Regel, nicht mit einer
// ähnlichen:
//
//  1. `tageswerte` nimmt je Set und Tag genau EINEN Preis — den zuletzt
//     aufgezeichneten, bei gleichem Zeitstempel den mit dem gesuchten
//     Zustand. Das ist die Zeile, die in der alten Schleife als letzte in
//     `buckets[tag].sets[set]` landete und damit gewann.
//  2. `avg_price` zuerst, `qty_avg_price` als Ersatz — wie das alte
//     `parseFloat(r.avg_price||0) || parseFloat(r.qty_avg_price||0)`.
//  3. Die Fortschreibung (ein Set ohne neuen Wert behält seinen letzten
//     Preis) steckt in der Differenzrechnung: Je Set wird nur die ÄNDERUNG
//     zum Vortageswert gezählt, und die laufende Summe über die Tage ergibt
//     denselben Gesamtwert wie das alte `carry`-Objekt. Ohne diesen Kniff
//     wäre ein einfaches GROUP BY Tag zwar schnell, würde aber andere Zahlen
//     liefern — Tage ohne Messwert fielen aus der Summe.
//
// Ergebnis: eine Zeile je Tag statt einer je Set und Tag.
{
  const mengen = setNumbers.map(sn => setQty[sn] || 1);
  const hauptAbfrage = (bExpr: string) => db.all(
    `WITH mengen AS MATERIALIZED (
       SELECT * FROM unnest($3::text[], $4::int[]) AS m(set_number, qty)
     ),
     roh AS (
       SELECT ph.set_number,
              to_char(ph.recorded_at, @BUCKET@)             AS bucket,
              to_char(ph.recorded_at, 'YYYY-MM-DD')         AS tag,
              to_char(ph.recorded_at, 'YYYY-MM')            AS monat,
              ph.recorded_at,
              (ph.condition = $2)                           AS passender_zustand,
              COALESCE(NULLIF(ph.avg_price, 0), ph.qty_avg_price)::numeric AS preis
         FROM price_history ph
        WHERE ph.set_number = ANY($3::text[])
          AND ph.currency_code = $1 AND ph.condition IN ('U','N')
          AND (ph.qty_avg_price > 0 OR ph.avg_price > 0)
          ${dateFilter.replace(/recorded_at/g, 'ph.recorded_at')}
     ),
     werte AS (
       SELECT set_number, bucket,
              (array_agg(preis ORDER BY recorded_at DESC, passender_zustand DESC))[1] AS preis,
              max(tag)   AS letzter_tag,
              min(tag)   AS erster_tag,
              max(monat) AS monat
         FROM roh GROUP BY set_number, bucket
     ),
     -- Beschriftungen je Zeitabschnitt. Bewusst GETRENNT von der
     -- Wertrechnung: Unten wird der Ersteintrag eines Sets auf den Anfang
     -- der Reihe umgehängt, und ein max(tag) über umgehängte Zeilen
     -- ergäbe für den ersten Punkt ein späteres Datum als er hat.
     tage AS (
       SELECT bucket, max(letzter_tag) AS tag, min(erster_tag) AS erster_tag,
              max(monat) AS monat
         FROM werte GROUP BY bucket
     ),
     mit_vortag AS (
       SELECT w.*,
              LAG(preis) OVER (PARTITION BY set_number ORDER BY bucket) AS vortag,
              -- Anfang der GANZEN Reihe, nicht des jeweiligen Sets.
              MIN(bucket) OVER () AS erstes_bucket
         FROM werte w
     ),
     delta AS (
       -- Der ERSTE bekannte Preis eines Sets zählt am Anfang der Reihe, nicht
       -- an dem Tag, an dem der Preis-Job das Set zum ersten Mal gesehen hat.
       -- Genau das ist die Rückschreibung: Der heutige Bestand steht über den
       -- ganzen Zeitraum im Korb, und ein spät dazugekommenes Set verschiebt
       -- die Kurve erst, wenn sich sein Preis bewegt.
       SELECT CASE WHEN v.vortag IS NULL THEN v.erstes_bucket ELSE v.bucket END AS bucket,
              SUM(m.qty * (v.preis - COALESCE(v.vortag, 0))) AS d
         FROM mit_vortag v JOIN mengen m ON m.set_number = v.set_number
        GROUP BY 1
     )
     SELECT t.bucket AS day, t.tag AS full_day, t.erster_tag AS first_day, t.monat AS month,
            ROUND(SUM(COALESCE(d.d, 0)) OVER (ORDER BY t.bucket), 2) AS total
       FROM tage t LEFT JOIN delta d ON d.bucket = t.bucket
      ORDER BY t.bucket`.replace('@BUCKET@', bExpr),
    [currency, condition, setNumbers, mengen]
  );

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
    const roh = await db.all(
      `SELECT set_number, qty_avg_price, avg_price,
              to_char(fetched_at,'YYYY-MM-DD') AS day,
              to_char(fetched_at,'YYYY-MM')    AS month
       FROM price_cache
       WHERE currency_code=$1 AND condition IN ('U','N') AND set_number IN (${placeholders})
         AND (qty_avg_price>0 OR avg_price>0)
       ORDER BY fetched_at ASC, (condition = $2) ASC`,
      [currency, condition, ...setNumbers]
    );
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
    .map(r => ({ day: r.day, fullDay: r.full_day || r.day, month: r.month, total: parseFloat(r.total) }))
    .filter(p => p.total > 0);

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
    const start = await db.all(
      `WITH mengen AS MATERIALIZED (
         SELECT * FROM unnest($3::text[], $4::int[]) AS m(set_number, qty)
       ),
       letzte AS (
         SELECT DISTINCT ON (ph.set_number) ph.set_number,
                COALESCE(NULLIF(ph.avg_price, 0), ph.qty_avg_price)::numeric AS preis
           FROM price_history ph
          WHERE ph.set_number = ANY($3::text[])
            AND ph.currency_code = $1 AND ph.condition IN ('U','N')
            AND (ph.qty_avg_price > 0 OR ph.avg_price > 0)
            -- Derselbe Zeitraumfilter wie oben: Daten VOR dem Fenster zählen
            -- auch beim Startpunkt nicht mit, sonst begänne „Jahr" höher als
            -- die Monatskurve.
            ${dateFilter.replace(/recorded_at/g, 'ph.recorded_at')}
          -- Bevorzugt der letzte Preis VOR dem Starttag; hat ein Set damals
          -- noch keinen, gilt sein FRÜHESTER bekannter — dieselbe
          -- Rückschreibung wie in der Hauptabfrage. Ohne diesen Rückfall
          -- setzte die Korrektur den ersten Punkt wieder auf „nur die damals
          -- schon bekannten Sets" und holte den Sprung zurück.
          ORDER BY ph.set_number,
                   (ph.recorded_at < ($5::date + 1)) DESC,
                   CASE WHEN ph.recorded_at < ($5::date + 1) THEN ph.recorded_at END DESC NULLS LAST,
                   ph.recorded_at ASC,
                   (ph.condition = $2) DESC
       )
       SELECT ROUND(SUM(m.qty * l.preis), 2) AS total
         FROM letzte l JOIN mengen m ON m.set_number = l.set_number`,
      [currency, condition, setNumbers, mengen, ersterTag]
    ).catch(() => []);
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
