/** Was die Dienste des Bereichs bekommen: Zugang, Dienste tieferer Bereiche, Arbeitseinheit.
 * Getrennt von bereich.ts, damit ein Dienst seinen Typ ohne Importzyklus kennt. */
import type { Db } from '../../db/database';
import { bindeZugang, type Kontext } from '../infra/bereich';
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
  figurenListe: bindeZugang(db, figurenListe),
  figurTeile: bindeZugang(db, figurTeile),
  manuelleFiguren: bindeZugang(db, manuelleFiguren),
});
export type FigurenKontext = Kontext<FigurenAbhaengigkeiten, ReturnType<typeof zugang>>;
