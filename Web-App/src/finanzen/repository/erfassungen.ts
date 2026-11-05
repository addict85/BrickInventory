import * as db from '../../../db/database';
import { kaufpreisSpalten } from '../../../db/geldSql';

/** `id` als zweites Sortierkriterium: Zwei Erfassungen können denselben
 * Zeitstempel tragen. */
export interface SetErfassungsZeile {
  id: number; user_id: number; set_number: string; quantity: number;
  purchase_price: number | null; kaufpreis_fremd: boolean; kaufpreis_original: number | null;
  kaufpreis_umgerechnet: boolean; currency: string | null; price_estimated: boolean;
  condition: string; created_at: Date | null;
}

export function ladeSetErfassungen(uids: number[], waehrung: string) {
  return db.all<SetErfassungsZeile>(
    `SELECT id, user_id, set_number, quantity,
            ${kaufpreisSpalten('purchase_price', '$2')},
            currency, price_estimated,
            COALESCE(condition, 'N') AS condition, created_at
       FROM set_acquisitions
      WHERE user_id = ANY($1)
      ORDER BY created_at ASC, id ASC`, [uids, waehrung]);
}
