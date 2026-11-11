import type { DbSchnittstelle } from '../../../db/database';
import { setStammJoin, SET } from '../../../db/katalogSicht';

/** Eine Zeile je Set über alle Konten: Die Rechnung fasst die Käufe je
 * Setnummer zusammen; zwei Konten mit demselben Set zählten sonst doppelt. */
export function setsMitErfassungen(db: DbSchnittstelle, uids: number[]) {
  return db.all<{ set_number: string; name: string | null; year: number | null; quantity: number; image_local: string | null; image_url: string | null; added_at: Date; acq_count: number; used_count: number }>(`SELECT s.set_number, ${SET.name} AS name, ${SET.jahr} AS year,
            -- Menge aus den Erfassungen (Gruppierung a unten), kein zweiter JOIN.
            COALESCE(SUM(a.total_qty), 0)::int AS quantity,
            c.image_local, c.image_url, MIN(s.added_at) AS added_at,
            -- effectiveCondition() leitet den Zustand aus diesen Zählern ab.
            COALESCE(SUM(a.acq_count), 0)::int  AS acq_count,
            COALESCE(SUM(a.used_count), 0)::int AS used_count
     -- Name und Jahr aus rb_sets, die Bilder aus set_catalog (0105).
     FROM sets s
     LEFT JOIN set_catalog c ON c.set_number = s.set_number
     ${setStammJoin('s.set_number')}
     LEFT JOIN (
       SELECT user_id, set_number,
              SUM(quantity) AS total_qty,
              COUNT(*)                                AS acq_count,
              COUNT(*) FILTER (WHERE condition = 'U')  AS used_count
       FROM set_acquisitions GROUP BY user_id, set_number
     ) a ON a.user_id = s.user_id AND a.set_number = s.set_number
     WHERE s.user_id = ANY($1)
     GROUP BY s.set_number, rs.name, rs.year, c.image_local, c.image_url`, [uids]);
}

export function frischeMarktpreise(db: DbSchnittstelle, setNumbers: string[], currency: string, ttl: number) {
  return db.all<{ set_number: string; condition: string; avg_price: number | null; qty_avg_price: number | null }>(`SELECT set_number, condition, avg_price, qty_avg_price FROM price_cache
         WHERE set_number = ANY($1) AND condition IN ('U','N') AND currency_code=$2
           AND fetched_at > NOW() - make_interval(hours => $3)`, [setNumbers, currency, ttl]);
}

export function letzteMarktpreiseAusVerlauf(db: DbSchnittstelle, setNumbers: string[], currency: string) {
  return db.all<{ set_number: string; condition: string; avg_price: number | null; qty_avg_price: number | null }>(`SELECT DISTINCT ON (set_number, condition) set_number, condition, avg_price, qty_avg_price
         FROM price_history
         WHERE set_number = ANY($1) AND currency_code=$2 AND condition IN ('U','N')
         ORDER BY set_number, condition, recorded_at ASC`, [setNumbers, currency]);
}
