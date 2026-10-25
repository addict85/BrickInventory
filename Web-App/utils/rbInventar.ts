/**
 * Das neueste Rebrickable-Inventar zu einer Nummer nachschlagen.
 * Ausführlich: docs/begruendungen/utils/rbInventar.ts.md#abschnitt
 */
import * as db from '../db/database';
import { beideSchreibweisen } from './setNummer';

/**
 * Unter welchen Namen kann ein Set im Rebrickable-Inventar stehen?
 *
 * Rebrickable führt Sets mit Versionsanhang („10179-1"). Fehlt der in der
 * Eingabe, wird „-1" ergänzt; zusätzlich wird die blanke Nummer geprüft, weil
 * ältere Bestände auch so abgelegt sein können.
 */
export function inventarKandidaten(setNumber: string): [string, string] {
  return beideSchreibweisen(setNumber);
}

/**
 * Die id des neuesten Inventars zu einem der Kandidaten, sonst null.
 *
 * Fehler werden NICHT geschluckt: Die Aufrufer gehen unterschiedlich damit um
 * — die einen antworten mit 500, die anderen fallen still auf eine andere
 * Quelle zurück. Wer das Zweite will, hängt sein eigenes `.catch(() => null)`
 * an; hier stünde sonst die Entscheidung für alle.
 */
export async function inventarNachKandidaten(kandidaten: string[]): Promise<number | null> {
  const [a, b] = [kandidaten[0], kandidaten[1] ?? kandidaten[0]];
  const row = await db.get(
    'SELECT id FROM rb_inventories WHERE set_num=$1 OR set_num=$2 ORDER BY version DESC LIMIT 1',
    [a, b]);
  return row ? row.id : null;
}

/** Wie inventarNachKandidaten, mit der Kandidatenregel für Set-Nummern. */
export async function neuestesInventar(setNumber: string): Promise<number | null> {
  return inventarNachKandidaten(inventarKandidaten(setNumber));
}
