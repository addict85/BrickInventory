/** Setting the storage location: a file of its own, because the function takes the context that
 * context.ts only builds from the other storage location services. */
import * as storages from './repository/storageLocation';
import type { Writer } from '../household';
import type { LagerArt } from './storageLocation';
import type { InventoryContext } from './context';

/** Who may write is decided by src/household/household.ts; this function
 * gets the finished set and does not ask again.
 * @returns how many rows were affected (0 = there is nothing to set) */
export async function setLocation(
  k: InventoryContext,
  kind: LagerArt,
  ownerIdsChoice: Writer | number[],
  keyRaw: (string | number)[],
  location: string | null,
): Promise<number> {
  const key = keyRaw.map(String);
  const ownerIds = await k.household.writeAreaFrom(ownerIdsChoice);
  if (location === null) return storages.sortLocationTo(k.db, kind, ownerIds, null, key);
  // A new name goes into the stock — before the assignment, which finds it via the ID.
  return k.transact(async t => {
    const ids = await storages.ownerWithRow(t.db, kind, ownerIds, key);
    if (!ids.length) return 0;
    await storages.takeLocationOn(t.db, ids, location);
    return storages.sortLocationTo(t.db, kind, ids, location, key);
  });
}
