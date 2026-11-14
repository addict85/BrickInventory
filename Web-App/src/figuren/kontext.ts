/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Db } from '../../db/database';
import { mit, type Kontext } from '../infra/bereich';
import * as figurenListe from './repository/figurenListe';
import * as figurTeile from './repository/figurTeile';
import * as manuelleFiguren from './repository/manuelleFiguren';
import type { EinstellungenDienste } from '../einstellungen';
import type { HaushaltDienste } from '../haushalt';
import type { KatalogDienste } from '../katalog';
import type { FinanzenDienste } from '../finanzen';
import type { BestandDienste } from '../bestand';
import type { Nacharbeit } from '../auftraege';

export interface FigurenAbhaengigkeiten {
  db: Db;
  einstellungen: EinstellungenDienste;
  haushalt: HaushaltDienste;
  katalog: KatalogDienste;
  finanzen: FinanzenDienste;
  bestand: BestandDienste;
  nacharbeit: Nacharbeit;
}

export const zugang = (db: Db) => ({
  figurenListe: {
    figurenGruppiert: mit(db)(figurenListe.figurenGruppiert),
    manuelleFigurenListe: mit(db)(figurenListe.manuelleFigurenListe),
    zustandszahlenManuellerFiguren: mit(db)(figurenListe.zustandszahlenManuellerFiguren),
    figurenKennzahlen: mit(db)(figurenListe.figurenKennzahlen),
  },
  figurTeile: {
    katalogTeileDerFigur: mit(db)(figurTeile.katalogTeileDerFigur),
    inventarTeileDerFigur: mit(db)(figurTeile.inventarTeileDerFigur),
    setMitFigur: mit(db)(figurTeile.setMitFigur),
  },
  manuelleFiguren: {
    figurZeileManuell: mit(db)(manuelleFiguren.figurZeileManuell),
    figurZeileMitZustand: mit(db)(manuelleFiguren.figurZeileMitZustand),
    legeFigurManuellAn: mit(db)(manuelleFiguren.legeFigurManuellAn),
    setzeFigurpreisNeueste: mit(db)(manuelleFiguren.setzeFigurpreisNeueste),
    setzeFigurzustandNeueste: mit(db)(manuelleFiguren.setzeFigurzustandNeueste),
    figurErfassungen: mit(db)(manuelleFiguren.figurErfassungen),
  },
});
export type FigurenKontext = Kontext<FigurenAbhaengigkeiten, ReturnType<typeof zugang>>;
