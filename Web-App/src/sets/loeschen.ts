import * as repo from './repository/sets';
import type { DbSchnittstelle } from '../../db/database';
import { asIds, blickfeldAus, writableIds, type Sicht } from '../haushalt/haushalt';
import { legeInPapierkorb } from '../bestand/papierkorb';
import type { BlickfeldEingabe as Blickfeld } from '../haushalt/haushalt';
import type { SetsKontext } from './kontext';

// Für Löschen und Wegfall; sonst verwaisen Teile. Ausführlich: docs/begruendungen/src/sets/loeschen.ts.md#deletesetrows
export async function deleteSetRows(tx: DbSchnittstelle, uids: number[], setNumber: string) {
  await repo.entferneSetZeilen(tx, uids, setNumber);
}

/** Standardmässig im ganzen Schreibbereich; eine Kontenwahl schränkt ihn ein, erweitert ihn nie. */
export async function loescheSetFuer(sk: SetsKontext, s: Sicht, setNumber: string) {
  const schreibbar = await writableIds(s.nutzer);
  const gewaehlt = s.konten === undefined ? schreibbar : await blickfeldAus(s);
  return deleteSet(
    sk,
    gewaehlt.filter(id => schreibbar.includes(id)),
    setNumber,
  );
}

export async function deleteSet(sk: SetsKontext, userId: Blickfeld, setNumber: string) {
  const uids = asIds(userId);
  // Atomar: Ein abgebrochenes DELETE liesse sonst Teile und Figuren ohne Set in
  // Teileliste und Finanzsummen zurück.
  return sk.db.transaction(async tx => {
    const besitzer = await repo.besitzerDesSets(tx, uids, setNumber);
    if (!besitzer.length) return false;
    // Ein Eintrag je Konto: Wiederhergestellt wird in das Konto, dem es gehörte.
    const papierkorb: number[] = [];
    for (const b of besitzer) {
      const id = await legeInPapierkorb(tx, 'set', b.user_id, setNumber);
      if (id !== null) papierkorb.push(id);
    }
    await deleteSetRows(tx, uids, setNumber);
    return papierkorb;
  });
}
