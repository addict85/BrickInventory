/**
 * Das neueste Rebrickable-Inventar zu einer Nummer nachschlagen.
 * Ausführlich: docs/begruendungen/utils/rbInventar.ts.md#abschnitt
 */
import * as db from '../db/database';
import { mitVersion } from '../src/sets/setNummer';

/**
 * Die id des neuesten Inventars zu einem der Kandidaten, sonst null.
 *
 * Fehler werden NICHT geschluckt: Die Aufrufer gehen unterschiedlich damit um
 * — die einen antworten mit 500, die anderen fallen still auf eine andere
 * Quelle zurück. Wer das Zweite will, hängt sein eigenes `.catch(() => null)`
 * an; hier stünde sonst die Entscheidung für alle.
 */
export async function inventarNachKandidaten(kandidaten: string[]): Promise<number | null> {
  const row = await db.get<{ id: number }>(
    'SELECT id FROM rb_inventories WHERE set_num = ANY($1) ORDER BY version DESC LIMIT 1', [kandidaten]);
  return row ? row.id : null;
}

/**
 * Das neueste Inventar eines Sets. rb_inventories führt Set-Nummern seit
 * Migration 0074 nur mit Versionsanhang; eine zweite Schreibweise gibt es nicht.
 */
export async function neuestesInventar(setNumber: string): Promise<number | null> {
  return inventarNachKandidaten([mitVersion(setNumber)]);
}
