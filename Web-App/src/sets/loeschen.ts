import * as repo from './repository/sets';
import { asIds, type Sicht, type ScopeInput as Blickfeld } from '../haushalt';
import type { SetsContext } from './kontext';

// Für Löschen und Wegfall; sonst verwaisen Teile. In der Transaktion des Aufrufers (`t`).
export async function deleteSetRows(t: SetsContext, uids: number[], setNumber: string) {
  await t.bestand.setInhalt.entfernen(uids, setNumber);
}

/** Standardmässig im ganzen Schreibbereich; eine Kontenwahl schränkt ihn ein, erweitert ihn nie. */
export async function deleteSetFor(sk: SetsContext, s: Sicht, setNumber: string) {
  const writable = await sk.haushalt.schreibbereich(s.nutzer);
  const gewaehlt = s.konten === undefined ? writable : await sk.haushalt.scopeFrom(s);
  return deleteSet(
    sk,
    gewaehlt.filter(id => writable.includes(id)),
    setNumber,
  );
}

/** null: Im Blickfeld gibt es das Set nicht; sonst die neuen Papierkorb-Einträge. */
export async function deleteSet(sk: SetsContext, userId: Blickfeld, setNumber: string): Promise<number[] | null> {
  const uids = asIds(userId);
  // Atomar: Ein abgebrochenes DELETE liesse sonst Teile und Figuren ohne Set in
  // Teileliste und Finanzsummen zurück.
  return sk.transaktion(async t => {
    const besitzer = await repo.ownerOfSets(t.db, uids, setNumber);
    if (!besitzer.length) return null;
    // Ein Eintrag je Konto: Wiederhergestellt wird in das Konto, dem es gehörte.
    const papierkorb: number[] = [];
    for (const b of besitzer) {
      const id = await t.bestand.putInTrash('set', b.user_id, setNumber);
      if (id !== null) papierkorb.push(id);
    }
    await deleteSetRows(t, uids, setNumber);
    return papierkorb;
  });
}
