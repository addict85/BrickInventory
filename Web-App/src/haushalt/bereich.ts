/** Die Fabrik des Bereichs: Wer die Datenbank braucht, nimmt den Zugang als
 * ersten Parameter; erzeugeHaushalt bindet ihn einmal für alle. So greift kein
 * Modul selbst auf den Zugang des Prozesses zu, und ein Test gibt einen eigenen. */
import type { Db } from '../../db/database';
import { bindeZugang } from '../infra/bereich';
import * as haushalt from './haushalt';
import * as repository from './repository';

export interface HaushaltKontext {
  db: Db;
}

export function erzeugeHaushalt(k: HaushaltKontext) {
  const { db } = k;
  return {
    db,
    haushalt: bindeZugang(db, haushalt, [
      'umzugsQuelle',
      'blickfeldAus',
      'darfSchreibenFuer',
      'einladungAnlegen',
      'haushaltsMitglieder',
      'haushaltsStand',
      'pruefeEinladung',
      'einladungEinloesen',
      'haushaltVon',
      'schreibzielOderNull',
      'schreibbereichAus',
      'schreibziel',
      'blickfeldIds',
      'siehtKonto',
      'kontenTrennen',
      'verwerfeGetrennt',
      'besitzerAnhaengen',
      'schreibbereich',
    ]),
    repository: bindeZugang(db, repository, [
      'belegeEinladung',
      'benutzerNamen',
      'besitzerDerErfassung',
      'einladenderZuCode',
      'elternkonten',
      'getrennteKetten',
      'gibEinladungFrei',
      'istVerknuepft',
      'kontoName',
      'kontoNamen',
      'legeEinladungAn',
      'loescheGetrenntHinweis',
      'offeneEinladungen',
      'raeumeEinladungenAuf',
      'trenne',
      'unterkonten',
    ]),
  };
}

export type HaushaltDienste = ReturnType<typeof erzeugeHaushalt>;
