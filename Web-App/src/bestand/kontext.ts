/** Was die Dienste des Bereichs bekommen: Zugang, Dienste tieferer Bereiche, Arbeitseinheit.
 * Getrennt von bereich.ts, damit ein Dienst seinen Typ ohne Importzyklus kennt. */
import type { Db } from '../../db/database';
import { bindeZugang, type Kontext } from '../infra/bereich';
import * as bestandExport from './repository/bestandExport';
import * as gemeinsam from './repository/gemeinsam';
import * as kaufErfassungen from './repository/kaufErfassungen';
import * as kennzahlen from './repository/kennzahlen';
import * as lagerort from './repository/lagerort';
import * as manuelleMengen from './repository/manuelleMengen';
import * as nachtrag from './repository/nachtrag';
import * as papierkorb from './repository/papierkorb';
import type { EinstellungenDienste } from '../einstellungen';
import type { HaushaltDienste } from '../haushalt';
import type { KontoDienste } from '../konto';
import type { KatalogDienste } from '../katalog';
import type { FinanzenDienste } from '../finanzen';
import * as lagerortDienst from './lagerort';

export interface BestandAbhaengigkeiten {
  db: Db;
  einstellungen: EinstellungenDienste;
  haushalt: HaushaltDienste;
  konto: KontoDienste;
  katalog: KatalogDienste;
  finanzen: FinanzenDienste;
}

export const zugang = (db: Db) => ({
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
    'orteVon',
    'vorgabeVon',
  ]),
  manuelleMengen: bindeZugang(db, manuelleMengen, ['summeDerErfassungen']),
  nachtrag: bindeZugang(db, nachtrag),
  papierkorb: bindeZugang(db, papierkorb, ['eintraege', 'entferneAeltere', 'entferneAlle', 'entferneEintragDesKontos']),
});
export type BestandKontext = Kontext<BestandAbhaengigkeiten, ReturnType<typeof zugang>>;
