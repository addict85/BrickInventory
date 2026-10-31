import * as db from '../../../db/database';
import { kaufpreisSpalten } from '../../../db/geldSql';

/** Kauferfassungen für die Bewertung, in der Anzeigewährung. */

/**
 * Alle Kauferfassungen fuer Sets im Blickfeld — aelteste zuerst.
 *
 * `id` als zweites Sortierkriterium, weil zwei Erfassungen denselben
 * Zeitstempel tragen koennen; ohne sie waere die Reihenfolge dem Zufall der
 * Datenbank ueberlassen.
 */
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
