// Ausführlich: docs/begruendungen/src/katalog/rbInventar.ts.md#abschnitt
import { inventarNachKandidaten } from './repository/katalogStamm';
import { mitVersion } from '../sets/setNummer';

/** Fehler werden NICHT geschluckt: Die Aufrufer gehen verschieden damit um,
 * hier stünde sonst die Entscheidung für alle. */
export { inventarNachKandidaten };

/** rb_inventories führt Set-Nummern nur mit Versionsanhang. */
export async function neuestesInventar(setNumber: string): Promise<number | null> {
  return inventarNachKandidaten([mitVersion(setNumber)]);
}
