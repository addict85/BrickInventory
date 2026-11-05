import * as db from '../../../db/database';
import { kaufpreisIn, mittelUeber } from '../../../db/geldSql';

export function tagespreiseDesSets(setNumber: string, currency: string, zustand: string) {
  return db.all<{ qty_avg_price: number | null; avg_price: number | null; min_price: number | null; max_price: number | null; recorded_at: string }>(`SELECT DISTINCT ON (to_char(recorded_at, 'YYYY-MM-DD'))
            qty_avg_price, avg_price, min_price, max_price,
            to_char(recorded_at, 'YYYY-MM-DD') AS recorded_at
       FROM price_history
      WHERE set_number = $1 AND currency_code = $2 AND condition = $3
      ORDER BY to_char(recorded_at, 'YYYY-MM-DD') ASC, recorded_at DESC`, [setNumber, currency, zustand]);
}

export function cachePreiseDesSets(setNumber: string, currency: string) {
  return db.all<{ condition: string; avg_price: number | null; min_price: number | null; max_price: number | null; fetched_at: Date }>(`SELECT condition, avg_price, min_price, max_price, fetched_at
       FROM price_cache
      WHERE set_number=$1 AND currency_code=$2 AND condition IN ('N','U') AND avg_price > 0`, [setNumber, currency]);
}

export function ersterKaufDesSets(uids: number[], setNumber: string, currency: string) {
  return db.get<{ purchase_price: number | null; added_day: string }>(`SELECT a.purchase_price AS purchase_price,
            to_char(COALESCE(a.created_at, s.added_at), 'YYYY-MM-DD') AS added_day
       FROM sets s
       LEFT JOIN LATERAL (
         SELECT ${kaufpreisIn('purchase_price', '$3')} AS purchase_price, created_at FROM set_acquisitions
          WHERE user_id = s.user_id AND set_number = s.set_number
          ORDER BY created_at ASC, id ASC LIMIT 1
       ) a ON true
      WHERE s.user_id = ANY($1) AND s.set_number=$2
      -- Bei mehreren Besitzern im Haushalt zählt die ÄLTESTE Erfassung —
      -- derselbe Massstab wie innerhalb eines Kontos.
      ORDER BY COALESCE(a.created_at, s.added_at) ASC LIMIT 1`, [uids, setNumber, currency]);
}

export function kaufschnittDesSets(uids: number[], setNumber: string, currency: string) {
  return db.all<{ condition: string; avg_purchase: number | null; qty: string }>(`SELECT condition, ${mittelUeber('k')} AS avg_purchase, SUM(quantity) AS qty
       FROM (SELECT condition, quantity, ${kaufpreisIn('purchase_price', '$3')} AS k
               FROM set_acquisitions
              -- Über ALLE Haushalts-Besitzer verdichtet — dieselbe Mengengewichtung,
              -- die auch die Bewertung im Haushalt anwendet.
              WHERE user_id = ANY($1) AND set_number = $2) e
      GROUP BY condition`, [uids, setNumber, currency]);
}

export function loescheAltenVerlauf(tage: string) {
  return db.run(`DELETE FROM price_history
      WHERE recorded_at < NOW() - ($1 || ' days')::interval`, [tage]);
}


/** `table` und `keySql` sind feste Ausdrücke der Aufrufer, keine Eingaben. */
export function manualSeries(table: string, keySql: string, keyVals: any[], currency: string, cond: 'N' | 'U') {
  return db.all<{ avg_price: number | null; qty_avg_price: number | null; recorded_at: string }>(
    `SELECT DISTINCT ON (to_char(recorded_at, 'YYYY-MM-DD'))
            avg_price, qty_avg_price, to_char(recorded_at, 'YYYY-MM-DD') AS recorded_at
       FROM ${table}
      WHERE ${keySql} AND currency_code = $${keyVals.length + 1} AND condition = $${keyVals.length + 2}
      ORDER BY to_char(recorded_at, 'YYYY-MM-DD') ASC, recorded_at DESC`,
    [...keyVals, currency, cond]
  );
}


export function cachePreiseNachSchluessel(cacheTable: string, keySql: string, keyVals: unknown[], currency: string) {
  return db.all<{ condition: string; avg_price: number | null }>(
    `SELECT condition, avg_price FROM ${cacheTable}
      WHERE ${keySql} AND currency_code = $${keyVals.length + 1} AND avg_price > 0
      ORDER BY fetched_at DESC`, [...keyVals, currency]);
}

export function kaufschnitteNachSchluessel(acqTable: string, acqKeySql: string, acqKeyVals: unknown[], uids: number[], currency: string) {
  return db.all<{ condition: string; avg_purchase: number | null }>(
    `SELECT condition, ${mittelUeber('k')} AS avg_purchase
       FROM (SELECT condition, quantity, ${kaufpreisIn('unit_price', `$${acqKeyVals.length + 2}`)} AS k
               FROM ${acqTable}
              WHERE ${acqKeySql} AND user_id = ANY($${acqKeyVals.length + 1})) e
      GROUP BY condition`, [...acqKeyVals, uids, currency]);
}
