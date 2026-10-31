/**
 * Das neueste Rebrickable-Inventar zu einer Nummer nachschlagen.
 * Ausführlich: docs/begruendungen/src/katalog/rbInventar.ts.md#abschnitt
 */
import { inventarNachKandidaten } from './repository/katalogStamm';
import { mitVersion } from '../sets/setNummer';

/**
 * Die id des neuesten Inventars zu einem der Kandidaten, sonst null.
 *
 * Fehler werden NICHT geschluckt: Die Aufrufer gehen unterschiedlich damit um
 * — die einen antworten mit 500, die anderen fallen still auf eine andere
 * Quelle zurück. Wer das Zweite will, hängt sein eigenes `.catch(() => null)`
 * an; hier stünde sonst die Entscheidung für alle.
 */
export { inventarNachKandidaten };

/**
 * Das neueste Inventar eines Sets. rb_inventories führt Set-Nummern seit
 * Migration 0074 nur mit Versionsanhang; eine zweite Schreibweise gibt es nicht.
 */
export async function neuestesInventar(setNumber: string): Promise<number | null> {
  return inventarNachKandidaten([mitVersion(setNumber)]);
}
