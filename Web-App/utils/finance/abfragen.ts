/**
 * Lesezugriffe, die MEHR ALS EINE Schicht des Finanzteils braucht.
 *
 * ── Warum es diese Datei gibt (Nachtrag 171) ────────────────────────────────
 *
 * Die Kauferfassungen eines Blickfelds werden an zwei Stellen gebraucht: von
 * der Bewertung (welcher Zustand gilt) und von der Gewinnrechnung (was wurde
 * bezahlt). Die Abfrage stand deshalb ZWEIMAL — wortgleich, mit denselben
 * Spalten und derselben Sortierung.
 *
 * Aufgefallen ist das erst beim Trennen von utils/financeCalc.ts: Solange
 * beide in derselben Datei standen, sah sql-kerne.test.js nichts — die Regel
 * dort meldet eine Abfrage, die in mehr als einer DATEI steht. Innerhalb einer
 * Datei war die Dopplung unsichtbar.
 *
 * Die Sortierung ist dabei kein Zierrat: Beide Seiten rechnen den gewichteten
 * Kaufpreis in der Reihenfolge der Erfassung. Liefe eine anders, kaeme bei
 * gleichem Bestand ein anderer Gewinn heraus.
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
