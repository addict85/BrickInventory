/** Setting the storage location: a file of its own, because the function takes the context that
 * context.ts only builds from the other storage location services. */
import * as orte from './repository/storageLocation';
import type { Schreiber } from '../household';
import type { LagerArt } from './storageLocation';
import type { InventoryContext } from './context';

/** Who may write is decided by src/household/household.ts; this function
 * gets the finished set and does not ask again.
 * @returns how many rows were affected (0 = there is nothing to set) */
export async function setLocation(
  k: InventoryContext,
  art: LagerArt,
  ownerIdsChoice: Schreiber | number[],
  keyRaw: (string | number)[],
  ort: string | null,
): Promise<number> {
  const schluessel = keyRaw.map(String);
  const ownerIds = await k.household.writeAreaFrom(ownerIdsChoice);
  if (ort === null) return orte.sortLocationTo(k.db, art, ownerIds, null, schluessel);
  // A new name goes into the stock — before the assignment, which finds it via the ID.
  return k.transaktion(async t => {
    const ids = await orte.ownerWithRow(t.db, art, ownerIds, schluessel);
    if (!ids.length) return 0;
    await orte.takeLocationOn(t.db, ids, ort);
    return orte.sortLocationTo(t.db, art, ids, ort, schluessel);
  });
}
