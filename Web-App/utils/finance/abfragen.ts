/**
 * Lesezugriffe, die MEHR ALS EINE Schicht des Finanzteils braucht.
 * Ausführlich: docs/begruendungen/utils/finance/abfragen.ts.md#abschnitt
 */

import * as db from '../../db/database';

/**
 * Der Kaufpreis in der Anzeigewährung `w` (ein SQL-Parameter): gleiche Währung
 * unverändert, eine fremde zum Kurs des Kauftags (Migration 0077, sonst der
 * nächstfrühere). NULL, wenn kein Kurs da ist — dann zählt der Preis als
 * „fremde Währung, nicht eingerechnet“ wie vor den Kursen.
 */
export function kaufpreisIn(spalte: string, w: string): string {
  return `in_waehrung(${spalte}, currency, ${w}, COALESCE(tag, (created_at AT TIME ZONE 'UTC')::date))`;
}

/** Die drei Spalten jeder Erfassungsabfrage der Bewertung: Preis, fremd, umgerechnet. */
export function kaufpreisSpalten(spalte: string, w: string): string {
  const k = kaufpreisIn(spalte, w);
  return `${k} AS ${spalte},
            (currency <> ${w} AND ${spalte} IS NOT NULL AND ${k} IS NULL) AS kaufpreis_fremd,
            (currency <> ${w} AND ${k} IS NOT NULL) AS kaufpreis_umgerechnet`;
}

/** Wie viele Zeilen ein Merkmal tragen (kaufpreis_fremd bzw. kaufpreis_umgerechnet). */
export function zaehle(zeilen: Iterable<Record<string, unknown>>, merkmal: 'kaufpreis_fremd' | 'kaufpreis_umgerechnet'): number {
  let n = 0;
  for (const z of zeilen) if (z[merkmal]) n++;
  return n;
}

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
