import * as db from '../../../db/database';

/** Abfragen der Gewinn- und Verlustrechnung: Sets im Blickfeld und ihre Marktpreise. */

export function setsMitErfassungen(uids: unknown[]) {
  return db.all(`SELECT s.set_number, c.name, c.year,
            -- Menge aus den Erfassungen (Gruppierung a unten), kein zweiter JOIN.
            COALESCE(a.total_qty, 0)::int AS quantity,
            c.image_local, c.image_url, s.added_at,
            -- effectiveCondition() leitet den Zustand aus diesen Zählern ab.
            COALESCE(a.acq_count, 0)  AS acq_count,
            COALESCE(a.used_count, 0) AS used_count
     -- Name, Jahr und Bilder stehen seit Migration 0033 in set_catalog.
     FROM sets s
     LEFT JOIN set_catalog c ON c.set_number = s.set_number
     LEFT JOIN (
       SELECT user_id, set_number,
              SUM(quantity) AS total_qty,
              COUNT(*)                                AS acq_count,
              COUNT(*) FILTER (WHERE condition = 'U')  AS used_count
       FROM set_acquisitions GROUP BY user_id, set_number
     ) a ON a.user_id = s.user_id AND a.set_number = s.set_number
     WHERE s.user_id = ANY($1)`, [uids]);
}

/** Aus dem Cache, nur innerhalb der Gültigkeit (ttl). */
export function frischeMarktpreise(setNumbers: unknown, currency: unknown, ttl: unknown) {
  return db.all(`SELECT set_number, condition, avg_price, qty_avg_price FROM price_cache
         WHERE set_number = ANY($1) AND condition IN ('U','N') AND currency_code=$2
           AND fetched_at > NOW() - make_interval(hours => $3)`, [setNumbers, currency, ttl]);
}

/** Der jüngste Preis je Set und Zustand im Verlauf — wo der Cache nichts hat. */
export function letzteMarktpreiseAusVerlauf(setNumbers: unknown, currency: unknown) {
  return db.all(`SELECT DISTINCT ON (set_number, condition) set_number, condition, avg_price, qty_avg_price
         FROM price_history
         WHERE set_number = ANY($1) AND currency_code=$2 AND condition IN ('U','N')
         ORDER BY set_number, condition, recorded_at ASC`, [setNumbers, currency]);
}
