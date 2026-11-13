/** Was die Dienste des Bereichs bekommen: Zugang, Dienste tieferer Bereiche, Arbeitseinheit.
 * Getrennt von bereich.ts, damit ein Dienst seinen Typ ohne Importzyklus kennt. */
import type { Db } from '../../db/database';
import { bindeZugang, type Kontext } from '../infra/bereich';
import * as erfassungen from './repository/erfassungen';
import * as loeschen from './repository/loeschen';
import type { HaushaltDienste } from '../haushalt';
import type { AuftraegeDienste } from '../auftraege';
import type { KatalogDienste } from '../katalog';
import type { FinanzenDienste } from '../finanzen';
import type { BestandDienste } from '../bestand';
import type { SetsDienste } from '../sets';
import type { TeileDienste } from '../teile';
import type { FigurenDienste } from '../figuren';
import type { MerklisteDienste } from '../merkliste';

export interface SammlungAbhaengigkeiten {
  db: Db;
  haushalt: HaushaltDienste;
  auftraege: AuftraegeDienste;
  katalog: KatalogDienste;
  finanzen: FinanzenDienste;
  bestand: BestandDienste;
  sets: SetsDienste;
  teile: TeileDienste;
  figuren: FigurenDienste;
  merkliste: MerklisteDienste;
}

export const zugang = (db: Db) => ({
  erfassungen: bindeZugang(db, erfassungen, ['kontoDerErfassung', 'setErfassungenImBlickfeld', 'zustandDerErfassung']),
  loeschen: bindeZugang(db, loeschen, ['manuelleFigurenDesKontos', 'manuelleTeileDesKontos', 'setsDesKontos']),
});
export type SammlungKontext = Kontext<SammlungAbhaengigkeiten, ReturnType<typeof zugang>>;
