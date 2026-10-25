/**
 * Lesezugriffe, die MEHR ALS EINE Schicht des Finanzteils braucht.
 * Ausführlich: docs/begruendungen/utils/finance/abfragen.ts.md#abschnitt
 */

import * as db from '../../db/database';

/**
 * Alle Kauferfassungen fuer Sets im Blickfeld — aelteste zuerst.
 *
 * `id` als zweites Sortierkriterium, weil zwei Erfassungen denselben
 * Zeitstempel tragen koennen; ohne sie waere die Reihenfolge dem Zufall der
 * Datenbank ueberlassen.
 */
export function ladeSetErfassungen(uids: number[]): Promise<any[]> {
  return db.all(
    `SELECT id, set_number, quantity, purchase_price,
            COALESCE(condition, 'N') AS condition, created_at
       FROM set_acquisitions
      WHERE user_id = ANY($1)
      ORDER BY created_at ASC, id ASC`, [uids]);
}
