/** Die Fabrik des Bereichs: Wer die Datenbank braucht, nimmt den Zugang als
 * ersten Parameter; erzeugeMerkliste bindet ihn einmal für alle. So greift kein
 * Modul selbst auf den Zugang des Prozesses zu, und ein Test gibt einen eigenen. */
import type { Db } from '../../db/database';
import { bindeZugang } from '../infra/bereich';
import * as merkliste from './repository/merkliste';
import * as wantedListe from './repository/wantedListe';

export interface MerklisteKontext {
  db: Db;
}

export function erzeugeMerkliste(k: MerklisteKontext) {
  const { db } = k;
  return {
    db,
    merkliste: bindeZugang(db, merkliste),
    wantedListe: bindeZugang(db, wantedListe),
  };
}

export type MerklisteDienste = ReturnType<typeof erzeugeMerkliste>;
