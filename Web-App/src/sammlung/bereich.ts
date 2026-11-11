/** Die Fabrik des Bereichs: Wer die Datenbank braucht, nimmt den Zugang als
 * ersten Parameter; erzeugeSammlung bindet ihn einmal für alle. So greift kein
 * Modul selbst auf den Zugang des Prozesses zu, und ein Test gibt einen eigenen. */
import type { Db } from '../../db/database';
import { bindeZugang } from '../infra/bereich';
import * as erfassungen from './repository/erfassungen';
import * as loeschen from './repository/loeschen';

export interface SammlungKontext {
  db: Db;
}

export function erzeugeSammlung(k: SammlungKontext) {
  const { db } = k;
  return {
    db,
    erfassungen: bindeZugang(db, erfassungen, [
      'kontoDerErfassung',
      'setErfassungenImBlickfeld',
      'zustandDerErfassung',
    ]),
    loeschen: bindeZugang(db, loeschen, ['manuelleFigurenDesKontos', 'manuelleTeileDesKontos', 'setsDesKontos']),
  };
}

export type SammlungDienste = ReturnType<typeof erzeugeSammlung>;
