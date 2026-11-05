import * as db from '../../../db/database';

export function tageswerteAusVerlauf(currency: string, condition: string, setNumbers: string[], mengen: number[], datumsFilter: string, bExpr: string) {
  return db.all<{ day: string; full_day?: string; first_day?: string; month: string; total: number | string }>(`WITH mengen AS MATERIALIZED (
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
          ${datumsFilter}
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
      ORDER BY t.bucket`.replace('@BUCKET@', bExpr), [currency, condition, setNumbers, mengen]);
}

export function cachePreiseDerSets(currency: string, condition: string, setNumbers: string[], placeholders: string) {
  return db.all<{ set_number: string; qty_avg_price: number | null; avg_price: number | null; day: string; month: string }>(`SELECT set_number, qty_avg_price, avg_price,
              to_char(fetched_at,'YYYY-MM-DD') AS day,
              to_char(fetched_at,'YYYY-MM')    AS month
       FROM price_cache
       WHERE currency_code=$1 AND condition IN ('U','N') AND set_number IN (${placeholders})
         AND (qty_avg_price>0 OR avg_price>0)
       ORDER BY fetched_at ASC, (condition = $2) ASC`, [currency, condition, ...setNumbers]);
}

export function letzteWerteVorBeginn(currency: string, condition: string, setNumbers: string[], mengen: number[], ersterTag: string, datumsFilter: string) {
  return db.all<{ total: number }>(`WITH mengen AS MATERIALIZED (
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
            ${datumsFilter}
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
         FROM letzte l JOIN mengen m ON m.set_number = l.set_number`, [currency, condition, setNumbers, mengen, ersterTag]);
}

export function setsMitKaufsumme(uids: number[]) {
  return db.all<{ set_number: string; quantity: number; purchase_price: number | null }>(`SELECT s.set_number, COALESCE(SUM(a.total_qty), 0)::int AS quantity,
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
}
