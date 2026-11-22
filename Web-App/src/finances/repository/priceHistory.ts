import type { DbInterface } from '../../../db/database';
import type { FinancesReadContract } from '../readContract';
import { purchasePriceIn, marketPriceSql, averageOver } from '../../../db/moneySql';

export function dailyPricesOfSets(db: DbInterface, setNumber: string, currency: string, condition: string) {
  return db.all<{
    qty_avg_price: number | null;
    avg_price: number | null;
    min_price: number | null;
    max_price: number | null;
    recorded_at: string;
  }>(
    `SELECT DISTINCT ON (to_char(recorded_at, 'YYYY-MM-DD'))
            qty_avg_price, avg_price, min_price, max_price,
            to_char(recorded_at, 'YYYY-MM-DD') AS recorded_at
       FROM price_history
      WHERE set_number = $1 AND currency_code = $2 AND condition = $3
      ORDER BY to_char(recorded_at, 'YYYY-MM-DD') ASC, recorded_at DESC`,
    [setNumber, currency, condition],
  );
}

export function cachePricesOfSets(db: DbInterface, setNumber: string, currency: string) {
  return db.all<{
    condition: string;
    avg_price: number | null;
    qty_avg_price: number | null;
    min_price: number | null;
    max_price: number | null;
    fetched_at: Date;
  }>(
    `SELECT condition, avg_price, qty_avg_price, min_price, max_price, fetched_at
       FROM price_cache
      WHERE set_number=$1 AND currency_code=$2 AND condition IN ('N','U') AND ${marketPriceSql()} IS NOT NULL`,
    [setNumber, currency],
  );
}

export function firstPurchaseOfSets(
  db: DbInterface,
  l: FinancesReadContract,
  uids: number[],
  setNumber: string,
  currency: string,
) {
  return db.get<{ purchase_price: number | null; added_day: string }>(
    `SELECT a.purchase_price AS purchase_price,
            to_char(COALESCE(a.created_at, s.added_at), 'YYYY-MM-DD') AS added_day
       FROM ${l.setBestand('= ANY($1)')} s
       LEFT JOIN LATERAL (
         SELECT ${purchasePriceIn('purchase_price', '$3')} AS purchase_price, created_at FROM ${l.setErfassungen()} e
          WHERE user_id = s.user_id AND set_number = s.set_number
          ORDER BY created_at ASC, id ASC LIMIT 1
       ) a ON true
      WHERE s.user_id = ANY($1) AND s.set_number=$2
      -- Bei mehreren Besitzern im Haushalt zählt die ÄLTESTE Erfassung —
      -- derselbe Massstab wie innerhalb eines Kontos.
      ORDER BY COALESCE(a.created_at, s.added_at) ASC LIMIT 1`,
    [uids, setNumber, currency],
  );
}

export function purchaseAverageOfSets(
  db: DbInterface,
  l: FinancesReadContract,
  uids: number[],
  setNumber: string,
  currency: string,
) {
  return db.all<{ condition: string; avg_purchase: number | null; qty: string }>(
    `SELECT condition, ${averageOver('k')} AS avg_purchase, SUM(quantity) AS qty
       FROM (SELECT condition, quantity, ${purchasePriceIn('purchase_price', '$3')} AS k
               FROM ${l.setErfassungen('= ANY($1)')} x
              -- Über ALLE Haushalts-Besitzer verdichtet — dieselbe Mengengewichtung,
              -- die auch die Bewertung im Haushalt anwendet.
              WHERE user_id = ANY($1) AND set_number = $2) e
      GROUP BY condition`,
    [uids, setNumber, currency],
  );
}

export function deleteOldHistory(db: DbInterface, days: string) {
  return db.run(
    `DELETE FROM price_history
      WHERE recorded_at < NOW() - ($1 || ' days')::interval`,
    [days],
  );
}

/** The kind chooses the tables here, not the caller: that way the repository states what it reads. */
const PRICE_TABLES = {
  part: { verlauf: 'part_price_history', cache: 'part_price_cache' },
  fig: { verlauf: 'minifig_price_history', cache: 'minifig_price_cache' },
} as const;

/** `keySql` is a fixed expression of the callers, not an input. */
export function manualSeries(
  db: DbInterface,
  kind: 'part' | 'fig',
  keySql: string,
  keyVals: unknown[],
  currency: string,
  cond: 'N' | 'U',
) {
  return db.all<{ avg_price: number | null; qty_avg_price: number | null; recorded_at: string }>(
    `SELECT DISTINCT ON (to_char(recorded_at, 'YYYY-MM-DD'))
            avg_price, qty_avg_price, to_char(recorded_at, 'YYYY-MM-DD') AS recorded_at
       FROM ${PRICE_TABLES[kind].verlauf}
      WHERE ${keySql} AND currency_code = $${keyVals.length + 1} AND condition = $${keyVals.length + 2}
      ORDER BY to_char(recorded_at, 'YYYY-MM-DD') ASC, recorded_at DESC`,
    [...keyVals, currency, cond],
  );
}

export function cachePricesAfterKey(
  db: DbInterface,
  kind: 'part' | 'fig',
  keySql: string,
  keyVals: unknown[],
  currency: string,
) {
  return db.all<{ condition: string; avg_price: number | null; qty_avg_price: number | null }>(
    `SELECT condition, avg_price, qty_avg_price FROM ${PRICE_TABLES[kind].cache}
      WHERE ${keySql} AND currency_code = $${keyVals.length + 1} AND ${marketPriceSql()} IS NOT NULL
      ORDER BY fetched_at DESC`,
    [...keyVals, currency],
  );
}

export function purchaseAveragesByKey(
  db: DbInterface,
  l: FinancesReadContract,
  kind: 'part' | 'fig',
  acqKeySql: string,
  acqKeyVals: unknown[],
  uids: number[],
  currency: string,
) {
  return db.all<{ condition: string; avg_purchase: number | null }>(
    `SELECT condition, ${averageOver('k')} AS avg_purchase
       FROM (SELECT condition, quantity, ${purchasePriceIn('unit_price', `$${acqKeyVals.length + 2}`)} AS k
               FROM ${kind === 'part' ? l.teilErfassungen() : l.figurErfassungen()} x
              WHERE ${acqKeySql} AND user_id = ANY($${acqKeyVals.length + 1})) e
      GROUP BY condition`,
    [...acqKeyVals, uids, currency],
  );
}
