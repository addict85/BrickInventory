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
export function ladeSetErfassungen(uids: number[], waehrung: string): Promise<any[]> {
  // Ein Kaufpreis in einer anderen Währung ist in dieser Rechnung unbekannt —
  // ihn als Betrag der Anzeigewährung zu summieren, wäre stillschweigend falsch.
  return db.all(
    `SELECT id, set_number, quantity,
            CASE WHEN currency = $2 THEN purchase_price END AS purchase_price,
            (currency <> $2 AND purchase_price IS NOT NULL) AS kaufpreis_fremd,
            currency, price_estimated,
            COALESCE(condition, 'N') AS condition, created_at
       FROM set_acquisitions
      WHERE user_id = ANY($1)
      ORDER BY created_at ASC, id ASC`, [uids, waehrung]);
}
