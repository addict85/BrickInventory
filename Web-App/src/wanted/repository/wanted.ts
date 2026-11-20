import { setBestand } from '../../../db/bestandSicht';
import type { DbInterface, Treffer } from '../../../db/database';
import { marktpreisSql } from '../../../db/geldSql';
import { LIKE_ESCAPE, containsPattern } from '../../../db/likeSuche';
import { fromTable } from '../../infra/validate';

export function markSetWanted(db: DbInterface, userId: number, sn: string, c: string, seit: Date | string | null) {
  return db.get<{ war_neu: boolean }>(
    `INSERT INTO wanted (user_id, set_number, condition, created_at)
     VALUES ($1,$2,$3, COALESCE($4::timestamptz, NOW()))
     ON CONFLICT (user_id, set_number, condition) DO UPDATE
        SET condition = wanted.condition
     RETURNING (xmax = 0) AS war_neu`,
    [userId, sn, c, seit],
  );
}

export function removeWantedEntry(db: DbInterface, userId: number, setNumber: string, c: string) {
  return db.run('DELETE FROM wanted WHERE user_id=$1 AND set_number=$2 AND condition=$3', [userId, setNumber, c]);
}

export function isWanted(db: DbInterface, zuId: number, sn: string, c: string) {
  return db.get<Treffer>('SELECT 1 FROM wanted WHERE user_id=$1 AND set_number=$2 AND condition=$3', [zuId, sn, c]);
}

export function transferWantedEntry(db: DbInterface, zuId: number, ofId: number, sn: string, c: string) {
  return db.run('UPDATE wanted SET user_id=$1 WHERE user_id=$2 AND set_number=$3 AND condition=$4', [
    zuId,
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
  price_desc: `${marktpreisSql('pc')} DESC NULLS LAST`,
  price_asc: `${marktpreisSql('pc')} ASC NULLS LAST`,
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
  marktpreis: number | null;
  owned: boolean;
};

export function wantedListInScope(db: DbInterface, userIds: number[], f: WantedSelection, waehrung: string) {
  const werte: unknown[] = [userIds];
  let wo = '';
  if (f.setOnly) {
    werte.push(f.setOnly);
    wo += ` AND w.set_number = $${werte.length}`;
  }
  // Number AND name, as in the gallery; the name comes from the JOIN on rb_sets.
  if (f.search) {
    werte.push(containsPattern(f.search));
    wo +=
      ` AND (w.set_number ILIKE $${werte.length}${LIKE_ESCAPE}` + ` OR rb.name ILIKE $${werte.length}${LIKE_ESCAPE})`;
  }
  if (f.condition) {
    werte.push(f.condition);
    wo += ` AND w.condition = $${werte.length}`;
  }
  // fromTable(): direct access would also find inherited properties like "constructor".
  const ordnung = fromTable(WANTED_SORTS, f.sort, WANTED_SORTS.added_desc);
  werte.push(waehrung);
  const pWaehrung = `$${werte.length}`;
  return db.all<WantedRow>(
    `SELECT w.set_number, w.condition, w.created_at, w.user_id,
            rb.name, rb.year, rb.theme_id, rb.num_parts,
            sc.image_url,
            pa.direction AS alarm_direction, pa.threshold AS alarm_threshold,
            pa.triggered AS alarm_triggered,
            ${marktpreisSql('pc')} AS marktpreis,
            EXISTS (SELECT 1 FROM ${setBestand('= ANY($1)')} s
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
                               AND pc.currency_code = ${pWaehrung}
      WHERE w.user_id = ANY($1)${wo}
      ORDER BY ${ordnung}, w.set_number, w.condition`,
    werte,
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
