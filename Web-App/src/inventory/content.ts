/** What sets, parts and figures change on the inventory rows: the rows belong to the inventory,
 * the areas above call these services in their transaction (via t.bestand). */
import * as sharedRepo from './repository/shared';
import * as kaeufe from './repository/purchases';
import * as setContentRepo from './repository/setContent';
import type { InventoryContext } from './context';

type Zeile = { id: number; storage_id: number | null };

/** Purchases before the row (otherwise the daily index); a target keeps its storage location ("box 3" should stay). */
export async function recolorPartRow(
  k: InventoryContext,
  uid: number,
  teil: string,
  quelle: Zeile & { farbe: number },
  ziel: Zeile | null,
  neueFarbe: number,
) {
  const vereint = await kaeufe.stallSameEntriesOn(k.db, uid, teil, quelle.farbe, neueFarbe);
  await kaeufe.deleteToppedUpEntries(k.db, uid, teil, quelle.farbe, neueFarbe);
  const verschoben = await kaeufe.colorEntriesUm(k.db, uid, teil, quelle.farbe, neueFarbe);
  if (!ziel) await sharedRepo.colorPartRowUm(k.db, neueFarbe, quelle.id);
  else {
    if (quelle.storage_id && !ziel.storage_id) await sharedRepo.setPartLocation(k.db, quelle.storage_id, ziel.id);
    await sharedRepo.loescheTeilzeile(k.db, quelle.id);
  }
  return { vereint: vereint.changes ?? 0, verschoben: verschoben.changes ?? 0 };
}

/** A set's parts or figures: what the catalog names, and only that. */
export function enterParts(k: InventoryContext, uid: number, sn: string, teile: string[], farben: number[]) {
  return setContentRepo.enterSetParts(k.db, uid, sn, teile, farben);
}

export function enterMinifigs(k: InventoryContext, uid: number, sn: string, nummern: string[]) {
  return setContentRepo.enterSetMinifigs(k.db, uid, sn, nummern);
}

export function entfernen(k: InventoryContext, uids: number[], sn: string) {
  return sharedRepo.removeSetContent(k.db, uids, sn);
}

/** Only if the target has no contents yet: otherwise the summary would count it twice. */
export function kopieren(k: InventoryContext, tabelle: 'parts' | 'minifigs', sn: string, von: number, nach: number) {
  return sharedRepo.copySetContent(k.db, tabelle, sn, von, nach);
}

/** Without quantity: it arises from the acquisition below. */
export function putRowAn(k: InventoryContext, art: 'part' | 'fig', uid: number, schluessel: (string | number)[]) {
  return sharedRepo.putManualAn(k.db, art, uid, schluessel);
}

export function partsOfAccount(k: InventoryContext, uid: number) {
  return sharedRepo.manualPartsOfAccount(k.db, uid);
}

export function minifigsOfAccount(k: InventoryContext, uid: number) {
  return sharedRepo.manualMinifigsOfAccount(k.db, uid);
}
