/**
 * Das neueste Rebrickable-Inventar zu einer Nummer nachschlagen.
 *
 * Dieselbe Abfrage stand an acht Stellen — in vier verschiedenen Fassungen.
 * Sie unterscheiden sich nicht im SQL, sondern darin, WONACH gesucht wird:
 *
 *   Eingabe „9999" (Set-Nummer ohne Versionsanhang)
 *     jobs/catalogSync, jobs/partsCatalogEnrich,
 *     clients/rebrickable, routes/api_v1/sets    → '9999-1' ODER '9999'
 *     utils/handlers/parts.ts                    → '9999-1' ODER '9999-1'
 *     routes/api_v1/catalog.ts                   → nur '9999-1'
 *
 * Die beiden Abweichler finden eine Zeile, die unter der blanken Nummer
 * abgelegt ist, also nicht — die anderen sechs schon. In parts.ts ist der
 * zweite Kandidat sogar wortgleich mit dem ersten; die Abfrage fragt zweimal
 * dasselbe. Und in catalog.ts steht darüber „analog catalogSync", während
 * catalogSync zwei Kandidaten prüft.
 *
 * Deshalb steht die Kandidatenbildung hier, einmal, neben der Abfrage, die
 * sie benutzt.
 */
import * as db from '../db/database';

/**
 * Unter welchen Namen kann ein Set im Rebrickable-Inventar stehen?
 *
 * Rebrickable führt Sets mit Versionsanhang („10179-1"). Fehlt der in der
 * Eingabe, wird „-1" ergänzt; zusätzlich wird die blanke Nummer geprüft, weil
 * ältere Bestände auch so abgelegt sein können.
 */
export function inventarKandidaten(setNumber: string): [string, string] {
  const mitVersion = String(setNumber).includes('-') ? String(setNumber) : `${setNumber}-1`;
  return [mitVersion, mitVersion.replace(/-\d+$/, '')];
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
