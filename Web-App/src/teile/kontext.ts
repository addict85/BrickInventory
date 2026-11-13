/** Was die Dienste des Bereichs bekommen: Zugang, Dienste tieferer Bereiche, Arbeitseinheit.
 * Getrennt von bereich.ts, damit ein Dienst seinen Typ ohne Importzyklus kennt. */
import type { Db } from '../../db/database';
import type { Faecher } from '../infra/zwischenspeicher';
import { bindeZugang, type Kontext } from '../infra/bereich';
import * as manuelleTeile from './repository/manuelleTeile';
import * as teileListe from './repository/teileListe';
import * as teileZusammenfassung from './repository/teileZusammenfassung';
import * as teilFarbe from './repository/teilFarbe';
import type { EinstellungenDienste } from '../einstellungen';
import type { HaushaltDienste } from '../haushalt';
import type { KatalogDienste } from '../katalog';
import type { FinanzenDienste } from '../finanzen';
import type { BestandDienste } from '../bestand';

export interface TeileAbhaengigkeiten {
  db: Db;
  /** Zustand je Zugang (Neuaufbau der Teilezusammenfassung); erzeugeTeile legt sie an. */
  faecher: Faecher;
  einstellungen: EinstellungenDienste;
  haushalt: HaushaltDienste;
  katalog: KatalogDienste;
  finanzen: FinanzenDienste;
  bestand: BestandDienste;
}

export const zugang = (db: Db) => ({
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
});
export type TeileKontext = Kontext<TeileAbhaengigkeiten, ReturnType<typeof zugang>>;
