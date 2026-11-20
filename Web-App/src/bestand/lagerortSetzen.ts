/** Den Lagerort setzen: eigene Datei, weil die Funktion den Kontext nimmt, den
 * kontext.ts erst aus den übrigen Lagerort-Diensten baut. */
import * as orte from './repository/lagerort';
import type { Schreiber } from '../household';
import type { LagerArt } from './lagerort';
import type { InventoryContext } from './kontext';

/** Wer schreiben darf, entscheidet src/household/household.ts; diese Funktion
 * bekommt die fertige Menge und fragt nicht nach.
 * @returns wie viele Zeilen betroffen waren (0 = es gibt nichts zu setzen) */
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
  // Ein neuer Name kommt in den Vorrat — vor der Zuordnung, die ihn über die ID findet.
  return k.transaktion(async t => {
    const ids = await orte.ownerWithRow(t.db, art, ownerIds, schluessel);
    if (!ids.length) return 0;
    await orte.takeLocationOn(t.db, ids, ort);
    return orte.sortLocationTo(t.db, art, ids, ort, schluessel);
  });
}
