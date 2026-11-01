import * as db from '../../../db/database';
import { kaufpreisSpalten } from '../../../db/geldSql';

/** `id` als zweites Sortierkriterium: Zwei Erfassungen können denselben
 * Zeitstempel tragen. */
export function ladeSetErfassungen(uids: number[], waehrung: string): Promise<any[]> {
  return db.all(
    `SELECT id, set_number, quantity,
            ${kaufpreisSpalten('purchase_price', '$2')},
            currency, price_estimated,
            COALESCE(condition, 'N') AS condition, created_at
       FROM set_acquisitions
      WHERE user_id = ANY($1)
      ORDER BY created_at ASC, id ASC`, [uids, waehrung]);
}
