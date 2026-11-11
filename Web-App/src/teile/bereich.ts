/** Die Fabrik des Bereichs: Wer die Datenbank braucht, nimmt den Zugang als
 * ersten Parameter; erzeugeTeile bindet ihn einmal für alle. So greift kein
 * Modul selbst auf den Zugang des Prozesses zu, und ein Test gibt einen eigenen. */
import type { Db } from '../../db/database';
import { bindeZugang } from '../infra/bereich';
import * as manuelleTeile from './repository/manuelleTeile';
import * as teileListe from './repository/teileListe';
import * as teileZusammenfassung from './repository/teileZusammenfassung';
import * as teilFarbe from './repository/teilFarbe';

export interface TeileKontext {
  db: Db;
}

export function erzeugeTeile(k: TeileKontext) {
  const { db } = k;
  return {
    db,
    manuelleTeile: bindeZugang(db, manuelleTeile),
    teileListe: bindeZugang(db, teileListe, [
      'besitzteFiguren',
      'besitzteTeile',
      'farbenDesBestands',
      'gebrauchteManuelle',
      'hatUngeseheneBlNummer',
      'inventarAlsTeile',
      'kategorien',
      'kennzahlen',
      'manuelleTeile',
      'seiteAusZusammenfassung',
      'seiteLive',
    ]),
    teileZusammenfassung: bindeZugang(db, teileZusammenfassung, ['analysiere', 'gebauterStand', 'rohstand']),
    teilFarbe: bindeZugang(db, teilFarbe, ['rbFarbe']),
  };
}

export type TeileDienste = ReturnType<typeof erzeugeTeile>;
