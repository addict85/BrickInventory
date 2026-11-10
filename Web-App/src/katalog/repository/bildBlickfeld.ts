import * as db from '../../../db/database';

/** Alle Setnummern eines Blickfelds; `besitz` nur für Sets im Bestand. */
export function setsImBlickfeld(ids: number[]) {
  return db.all<{ set_number: string; besitz: boolean }>(
    `SELECT set_number, bool_or(besitz) AS besitz FROM (
       SELECT set_number, true AS besitz FROM sets WHERE user_id = ANY($1)
       UNION ALL SELECT set_number, false FROM wanted WHERE user_id = ANY($1)
       UNION ALL SELECT set_number, false FROM price_alerts WHERE user_id = ANY($1)) t
     GROUP BY set_number`, [ids]);
}
