/** Die Fabrik des Bereichs: Wer die Datenbank braucht, nimmt den Zugang als
 * ersten Parameter; erzeugeFiguren bindet ihn einmal für alle. So greift kein
 * Modul selbst auf den Zugang des Prozesses zu, und ein Test gibt einen eigenen. */
import type { Db } from '../../db/database';
import { bindeZugang } from '../infra/bereich';
import * as figurenListe from './repository/figurenListe';
import * as figurTeile from './repository/figurTeile';
import * as manuelleFiguren from './repository/manuelleFiguren';

export interface FigurenKontext {
  db: Db;
}

export function erzeugeFiguren(k: FigurenKontext) {
  const { db } = k;
  return {
    db,
    figurenListe: bindeZugang(db, figurenListe),
    figurTeile: bindeZugang(db, figurTeile),
    manuelleFiguren: bindeZugang(db, manuelleFiguren),
  };
}

export type FigurenDienste = ReturnType<typeof erzeugeFiguren>;
