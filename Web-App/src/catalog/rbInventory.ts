// Searches with and without the version suffix.
import { withVersion } from '../infra/setNumber';
import type { CatalogContext } from './context';

/** Errors are NOT swallowed: the callers deal with them differently,
 * otherwise the decision for all of them would be made here. */
export function inventoryForCandidates(k: CatalogContext, kandidaten: string[]): Promise<number | null> {
  return k.katalogStamm.inventoryAfterCandidates(kandidaten);
}

/** rb_inventories lists set numbers only with the version suffix. */
export async function newestInventory(k: CatalogContext, setNumber: string): Promise<number | null> {
  return k.katalogStamm.inventoryAfterCandidates([withVersion(setNumber)]);
}
