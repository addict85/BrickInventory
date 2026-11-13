// Sucht mit und ohne Versionsanhang.
import { mitVersion } from '../infra/setNummer';
import type { KatalogKontext } from './kontext';

/** Fehler werden NICHT geschluckt: Die Aufrufer gehen verschieden damit um,
 * hier stünde sonst die Entscheidung für alle. */
export function inventarFuerKandidaten(k: KatalogKontext, kandidaten: string[]): Promise<number | null> {
  return k.katalogStamm.inventarNachKandidaten(kandidaten);
}

/** rb_inventories führt Set-Nummern nur mit Versionsanhang. */
export async function neuestesInventar(k: KatalogKontext, setNumber: string): Promise<number | null> {
  return k.katalogStamm.inventarNachKandidaten([mitVersion(setNumber)]);
}
