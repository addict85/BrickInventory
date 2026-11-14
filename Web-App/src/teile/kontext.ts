/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Db } from '../../db/database';
import type { Faecher } from '../infra/zwischenspeicher';
import { mit, type Kontext } from '../infra/bereich';
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
  manuelleTeile: {
    teilZeileManuell: mit(db)(manuelleTeile.teilZeileManuell),
    teilZeileMitZustand: mit(db)(manuelleTeile.teilZeileMitZustand),
    legeTeilManuellAn: mit(db)(manuelleTeile.legeTeilManuellAn),
    rbFarbcode: mit(db)(manuelleTeile.rbFarbcode),
    setzeTeilpreisNeueste: mit(db)(manuelleTeile.setzeTeilpreisNeueste),
    setzeTeilzustandNeueste: mit(db)(manuelleTeile.setzeTeilzustandNeueste),
    teilErfassungen: mit(db)(manuelleTeile.teilErfassungen),
  },
  teileListe: {
    besitzteFiguren: mit(db)(teileListe.besitzteFiguren),
    besitzteTeile: mit(db)(teileListe.besitzteTeile),
    farbenDesBestands: mit(db)(teileListe.farbenDesBestands),
    gebrauchteManuelle: mit(db)(teileListe.gebrauchteManuelle),
    hatUngeseheneBlNummer: mit(db)(teileListe.hatUngeseheneBlNummer),
    inventarAlsTeile: mit(db)(teileListe.inventarAlsTeile),
    kategorien: mit(db)(teileListe.kategorien),
    kennzahlen: mit(db)(teileListe.kennzahlen),
    manuelleTeile: mit(db)(teileListe.manuelleTeile),
    seiteAusZusammenfassung: mit(db)(teileListe.seiteAusZusammenfassung),
    seiteLive: mit(db)(teileListe.seiteLive),
  },
  teileZusammenfassung: {
    analysiere: mit(db)(teileZusammenfassung.analysiere),
    gebauterStand: mit(db)(teileZusammenfassung.gebauterStand),
    rohstand: mit(db)(teileZusammenfassung.rohstand),
  },
  teilFarbe: {
    rbFarbe: mit(db)(teilFarbe.rbFarbe),
  },
});
export type TeileKontext = Kontext<TeileAbhaengigkeiten, ReturnType<typeof zugang>>;
