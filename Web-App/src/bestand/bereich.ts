/** Die Fabrik des Bereichs: Wer die Datenbank braucht, nimmt den Zugang als
 * ersten Parameter; erzeugeBestand bindet ihn einmal für alle. So greift kein
 * Modul selbst auf den Zugang des Prozesses zu, und ein Test gibt einen eigenen. */
import type { Db } from '../../db/database';
import { bindeZugang } from '../infra/bereich';
import * as bestandExport from './repository/bestandExport';
import * as gemeinsam from './repository/gemeinsam';
import * as kaufErfassungen from './repository/kaufErfassungen';
import * as kennzahlen from './repository/kennzahlen';
import * as lagerort from './repository/lagerort';
import * as lagerortDienst from './lagerort';
import * as manuelleMengen from './repository/manuelleMengen';
import * as nachtrag from './repository/nachtrag';
import * as papierkorb from './repository/papierkorb';

export interface BestandKontext {
  db: Db;
}

export function erzeugeBestand(k: BestandKontext) {
  const { db } = k;
  return {
    db,
    bestandExport: bindeZugang(db, bestandExport),
    gemeinsam: bindeZugang(db, gemeinsam, ['erfassungsKennzahlen', 'setsMitBestandteil']),
    kaufErfassungen: bindeZugang(db, kaufErfassungen, ['inWaehrungDesKontos']),
    kennzahlen: bindeZugang(db, kennzahlen),
    lagerort: bindeZugang(db, lagerort, [
      'andererOrtGleichenNamens',
      'entferneOrt',
      'fuegeOrtEin',
      'ortBelegung',
      'ortDesKontos',
      'ortNachName',
      'ortName',
      'orteDerKonten',
      'orteMitBestand',
      'schreibeOrtNamen',
      'vorgabeOrt',
    ]),
    lagerortDienst: bindeZugang(db, lagerortDienst, [
      'benenneOrtUm',
      'lagerorte',
      'legeOrtAn',
      'loescheOrt',
      'ortFuerNeuerfassung',
      'orteFuer',
      'orteVon',
      'setzeLagerort',
      'setzeVorgabe',
      'vorgabeVon',
    ]),
    manuelleMengen: bindeZugang(db, manuelleMengen, ['summeDerErfassungen']),
    nachtrag: bindeZugang(db, nachtrag),
    papierkorb: bindeZugang(db, papierkorb, [
      'eintraege',
      'entferneAeltere',
      'entferneAlle',
      'entferneEintragDesKontos',
    ]),
  };
}

export type BestandDienste = ReturnType<typeof erzeugeBestand>;
