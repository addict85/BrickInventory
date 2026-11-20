// Sucht mit und ohne Versionsanhang.
import { withVersion } from '../infra/setNumber';
import type { CatalogContext } from './context';

/** Fehler werden NICHT geschluckt: Die Aufrufer gehen verschieden damit um,
 * hier stünde sonst die Entscheidung für alle. */
export function inventoryForCandidates(k: CatalogContext, kandidaten: string[]): Promise<number | null> {
  return k.katalogStamm.inventoryAfterCandidates(kandidaten);
}

/** rb_inventories führt Set-Nummern nur mit Versionsanhang. */
export async function newestInventory(k: CatalogContext, setNumber: string): Promise<number | null> {
  return k.katalogStamm.inventoryAfterCandidates([withVersion(setNumber)]);
}
