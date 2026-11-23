/** What sets, parts and figures change on the inventory rows: the rows belong to the inventory,
 * the areas above call these services in their transaction (via t.bestand). */
import * as sharedRepo from './repository/shared';
import * as purchases from './repository/purchases';
import * as setContentRepo from './repository/setContent';
import type { InventoryContext } from './context';

type Row = { id: number; storage_id: number | null };

/** Purchases before the row (otherwise the daily index); a target keeps its storage location ("box 3" should stay). */
export async function recolorPartRow(
  k: InventoryContext,
  uid: number,
  part: string,
  source: Row & { color: number },
  target: Row | null,
  newColor: number,
) {
  const merged = await purchases.stallSameEntriesOn(k.db, uid, part, source.color, newColor);
  await purchases.deleteToppedUpEntries(k.db, uid, part, source.color, newColor);
  const moved = await purchases.recolorEntries(k.db, uid, part, source.color, newColor);
  if (!target) await sharedRepo.updatePartRowColor(k.db, newColor, source.id);
  else {
    if (source.storage_id && !target.storage_id) await sharedRepo.setPartLocation(k.db, source.storage_id, target.id);
    await sharedRepo.deletePartRowById(k.db, source.id);
  }
  return { united: merged.changes ?? 0, moved: moved.changes ?? 0 };
}

/** A set's parts or figures: what the catalog names, and only that. */
export function enterParts(k: InventoryContext, uid: number, sn: string, parts: string[], colors: number[]) {
  return setContentRepo.enterSetParts(k.db, uid, sn, parts, colors);
}

export function enterMinifigs(k: InventoryContext, uid: number, sn: string, numbers: string[]) {
  return setContentRepo.enterSetMinifigs(k.db, uid, sn, numbers);
}

export function removeContent(k: InventoryContext, uids: number[], sn: string) {
  return sharedRepo.removeSetContent(k.db, uids, sn);
}

/** Only if the target has no contents yet: otherwise the summary would count it twice. */
export function copy(k: InventoryContext, table: 'parts' | 'minifigs', sn: string, fromValue: number, nach: number) {
  return sharedRepo.copySetContent(k.db, table, sn, fromValue, nach);
}

/** Without quantity: it arises from the acquisition below. */
export function createRow(k: InventoryContext, kind: 'part' | 'fig', uid: number, key: (string | number)[]) {
  return sharedRepo.createManual(k.db, kind, uid, key);
}

export function partsOfAccount(k: InventoryContext, uid: number) {
  return sharedRepo.manualPartsOfAccount(k.db, uid);
}

export function minifigsOfAccount(k: InventoryContext, uid: number) {
  return sharedRepo.manualMinifigsOfAccount(k.db, uid);
}
