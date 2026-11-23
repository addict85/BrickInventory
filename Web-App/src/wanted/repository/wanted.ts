import { setHoldings } from '../../../db/inventoryView';
import type { DbInterface, Hit } from '../../../db/database';
import { marketPriceSql } from '../../../db/moneySql';
import { LIKE_ESCAPE, containsPattern } from '../../../db/likeSearch';
import { fromTable } from '../../infra/validate';

export function markSetWanted(db: DbInterface, userId: number, sn: string, c: string, since: Date | string | null) {
  return db.get<{ was_new: boolean }>(
    `INSERT INTO wanted (user_id, set_number, condition, created_at)
     VALUES ($1,$2,$3, COALESCE($4::timestamptz, NOW()))
     ON CONFLICT (user_id, set_number, condition) DO UPDATE
        SET condition = wanted.condition
     RETURNING (xmax = 0) AS was_new`,
    [userId, sn, c, since],
  );
}

export function removeWantedEntry(db: DbInterface, userId: number, setNumber: string, c: string) {
  return db.run('DELETE FROM wanted WHERE user_id=$1 AND set_number=$2 AND condition=$3', [userId, setNumber, c]);
}

export function isWanted(db: DbInterface, toId: number, sn: string, c: string) {
  return db.get<Hit>('SELECT 1 FROM wanted WHERE user_id=$1 AND set_number=$2 AND condition=$3', [toId, sn, c]);
}

export function transferWantedEntry(db: DbInterface, toId: number, ofId: number, sn: string, c: string) {
  return db.run('UPDATE wanted SET user_id=$1 WHERE user_id=$2 AND set_number=$3 AND condition=$4', [
    toId,
    ofId,
    sn,
    c,
  ]);
}

/** Same names as SET_SORTS: both UIs label them the same way. */
const WANTED_SORTS = {
  added_desc: 'w.created_at DESC',
  added_asc: 'w.created_at ASC',
  name_asc: 'rb.name ASC NULLS LAST',
  num_asc: 'w.set_number ASC',
  year_desc: 'rb.year DESC NULLS LAST',
  price_desc: `${marketPriceSql('pc')} DESC NULLS LAST`,
  price_asc: `${marketPriceSql('pc')} ASC NULLS LAST`,
};

export interface WantedSelection {
  setOnly: string | null;
  search: string | null;
  condition: 'N' | 'U' | null;
  sort: unknown;
}

export type WantedRow = {
  set_number: string;
  condition: string;
  created_at: Date;
  user_id: number;
  name: string | null;
  year: number | null;
  theme_id: number | null;
  num_parts: number | null;
  image_url: string | null;
  alarm_direction: string | null;
  alarm_threshold: number | null;
  alarm_triggered: boolean | null;
  market_price: number | null;
  owned: boolean;
};

export function wantedListInScope(db: DbInterface, userIds: number[], f: WantedSelection, currency: string) {
  const values: unknown[] = [userIds];
  let where = '';
  if (f.setOnly) {
    values.push(f.setOnly);
    where += ` AND w.set_number = $${values.length}`;
  }
  // Number AND name, as in the gallery; the name comes from the JOIN on rb_sets.
  if (f.search) {
    values.push(containsPattern(f.search));
    where +=
      ` AND (w.set_number ILIKE $${values.length}${LIKE_ESCAPE}` + ` OR rb.name ILIKE $${values.length}${LIKE_ESCAPE})`;
  }
  if (f.condition) {
    values.push(f.condition);
    where += ` AND w.condition = $${values.length}`;
  }
  // fromTable(): direct access would also find inherited properties like "constructor".
  const order = fromTable(WANTED_SORTS, f.sort, WANTED_SORTS.added_desc);
  values.push(currency);
  const pCurrency = `$${values.length}`;
  return db.all<WantedRow>(
    `SELECT w.set_number, w.condition, w.created_at, w.user_id,
            rb.name, rb.year, rb.theme_id, rb.num_parts,
            sc.image_url,
            pa.direction AS alarm_direction, pa.threshold AS alarm_threshold,
            pa.triggered AS alarm_triggered,
            ${marketPriceSql('pc')} AS market_price,
            EXISTS (SELECT 1 FROM ${setHoldings('= ANY($1)')} s
                     WHERE s.set_number = w.set_number) AS owned
       FROM wanted w
       LEFT JOIN rb_sets rb ON rb.set_num = w.set_number
       -- The image sits only in set_catalog (0108).
       LEFT JOIN set_catalog sc ON sc.set_number = w.set_number
       LEFT JOIN price_alerts pa ON pa.user_id = w.user_id
                                AND pa.set_number = w.set_number
                                AND pa.condition = w.condition
       -- The market price IN THIS wanted entry's condition. Without the condition
       -- clause, a used entry would show the new price — the same mix-up that once
       -- booked a used price as a new acquisition in addSet().
       LEFT JOIN price_cache pc ON pc.set_number = w.set_number
                               AND pc.condition = w.condition
                               AND pc.currency_code = ${pCurrency}
      WHERE w.user_id = ANY($1)${where}
      ORDER BY ${order}, w.set_number, w.condition`,
    values,
  );
}

export function wantedListForExport(db: DbInterface, uid: number) {
  return db.all<Record<string, unknown>>(
    `SELECT w.set_number,
            w.condition,
            TO_CHAR(w.created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS created_at
       FROM wanted w
      WHERE w.user_id = $1
      ORDER BY w.created_at DESC, w.set_number, w.condition`,
    [uid],
  );
}
