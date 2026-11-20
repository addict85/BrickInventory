/** Was Sets, Teile und Figuren an den Bestandszeilen ändern: Die Zeilen gehören dem Bestand,
 * die Bereiche darüber rufen diese Dienste in ihrer Transaktion (über t.bestand). */
import * as sharedRepo from './repository/shared';
import * as kaeufe from './repository/purchases';
import * as setContentRepo from './repository/setContent';
import type { InventoryContext } from './context';

type Zeile = { id: number; storage_id: number | null };

/** Käufe vor der Zeile (sonst Tagesindex); ein Ziel behält seinen Lagerort („Kiste 3“ soll bleiben). */
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

/** Die Teile oder Figuren eines Sets: was der Katalog nennt, und nur das. */
export function enterParts(k: InventoryContext, uid: number, sn: string, teile: string[], farben: number[]) {
  return setContentRepo.enterSetParts(k.db, uid, sn, teile, farben);
}

export function enterMinifigs(k: InventoryContext, uid: number, sn: string, nummern: string[]) {
  return setContentRepo.enterSetMinifigs(k.db, uid, sn, nummern);
}

export function entfernen(k: InventoryContext, uids: number[], sn: string) {
  return sharedRepo.removeSetContent(k.db, uids, sn);
}

/** Nur, wenn das Ziel noch keinen Inhalt hat: Sonst zählte die Zusammenfassung ihn doppelt. */
export function kopieren(k: InventoryContext, tabelle: 'parts' | 'minifigs', sn: string, von: number, nach: number) {
  return sharedRepo.copySetContent(k.db, tabelle, sn, von, nach);
}

/** Ohne Menge: Sie entsteht aus der Erfassung darunter. */
export function putRowAn(k: InventoryContext, art: 'part' | 'fig', uid: number, schluessel: (string | number)[]) {
  return sharedRepo.putManualAn(k.db, art, uid, schluessel);
}

export function partsOfAccount(k: InventoryContext, uid: number) {
  return sharedRepo.manualPartsOfAccount(k.db, uid);
}

export function minifigsOfAccount(k: InventoryContext, uid: number) {
  return sharedRepo.manualMinifigsOfAccount(k.db, uid);
}
