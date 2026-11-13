/** Die Fabrik des Bereichs: Wer die Datenbank braucht, nimmt den Zugang als
 * ersten Parameter; erzeugeHaushalt bindet ihn einmal für alle. So greift kein
 * Modul selbst auf den Zugang des Prozesses zu, und ein Test gibt einen eigenen. */
import { baueKontext, bindeZugang } from '../infra/bereich';
import * as haushalt from './haushalt';
import * as repository from './repository';
import { zugang, type HaushaltAbhaengigkeiten, type HaushaltKontext } from './kontext';

export type { HaushaltAbhaengigkeiten, HaushaltKontext } from './kontext';

export function erzeugeHaushalt(a: HaushaltAbhaengigkeiten) {
  const { db } = a;
  const k: HaushaltKontext = baueKontext(a, zugang);
  return {
    db,
    haushalt: {
      ...bindeZugang(db, haushalt, [
        'umzugsQuelle',
        'blickfeldAus',
        'darfSchreibenFuer',
        'einladungAnlegen',
        'haushaltsMitglieder',
        'haushaltsStand',
        'pruefeEinladung',
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
      einladungEinloesen: (uid: number, code: string) => haushalt.einladungEinloesen(k, uid, code),
    },
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
