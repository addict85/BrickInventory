// Sucht mit und ohne Versionsanhang.
import { mitVersion } from '../infra/setNummer';
import { katalog } from './prozess';
import type { KatalogDienste } from './bereich';

/** Fehler werden NICHT geschluckt: Die Aufrufer gehen verschieden damit um,
 * hier stünde sonst die Entscheidung für alle. */
export function inventarFuerKandidaten(kandidaten: string[]): Promise<number | null> {
  return katalog().katalogStamm.inventarNachKandidaten(kandidaten);
}

/** rb_inventories führt Set-Nummern nur mit Versionsanhang. */
export async function neuestesInventar(setNumber: string, k: KatalogDienste = katalog()): Promise<number | null> {
  return k.katalogStamm.inventarNachKandidaten([mitVersion(setNumber)]);
}
