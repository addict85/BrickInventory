import * as repo from './repository/sets';
import { asIds, type Sicht, type BlickfeldEingabe as Blickfeld } from '../haushalt';
import type { SetsKontext } from './kontext';

// Für Löschen und Wegfall; sonst verwaisen Teile. In der Transaktion des Aufrufers (`t`).
export async function deleteSetRows(t: SetsKontext, uids: number[], setNumber: string) {
  await repo.entferneSetZeilen(t.db, uids, setNumber);
  await t.bestand.entferneSetInhalt(uids, setNumber);
}

/** Standardmässig im ganzen Schreibbereich; eine Kontenwahl schränkt ihn ein, erweitert ihn nie. */
export async function loescheSetFuer(sk: SetsKontext, s: Sicht, setNumber: string) {
  const schreibbar = await sk.haushalt.schreibbereich(s.nutzer);
  const gewaehlt = s.konten === undefined ? schreibbar : await sk.haushalt.blickfeldAus(s);
  return loescheSet(
    sk,
    gewaehlt.filter(id => schreibbar.includes(id)),
    setNumber,
  );
}

/** null: Im Blickfeld gibt es das Set nicht; sonst die neuen Papierkorb-Einträge. */
export async function loescheSet(sk: SetsKontext, userId: Blickfeld, setNumber: string): Promise<number[] | null> {
  const uids = asIds(userId);
  // Atomar: Ein abgebrochenes DELETE liesse sonst Teile und Figuren ohne Set in
  // Teileliste und Finanzsummen zurück.
  return sk.transaktion(async t => {
    const besitzer = await repo.besitzerDesSets(t.db, uids, setNumber);
    if (!besitzer.length) return null;
    // Ein Eintrag je Konto: Wiederhergestellt wird in das Konto, dem es gehörte.
    const papierkorb: number[] = [];
    for (const b of besitzer) {
      const id = await t.bestand.legeInPapierkorb('set', b.user_id, setNumber);
      if (id !== null) papierkorb.push(id);
    }
    await deleteSetRows(t, uids, setNumber);
    return papierkorb;
  });
}
