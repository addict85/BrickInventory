/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Db } from '../../db/database';
import type { Kontext } from '../infra/bereich';
import type { HaushaltDienste } from '../haushalt';
import type { AuftraegeDienste } from '../auftraege';
import type { KatalogDienste } from '../katalog';
import type { FinanzenDienste } from '../finanzen';
import type { BestandDienste } from '../bestand';
import type { SetsDienste } from '../sets';
import type { TeileDienste } from '../teile';
import type { FigurenDienste } from '../figuren';
import type { MerklisteDienste } from '../merkliste';
import type { Uhr } from '../infra/uhr';

export interface SammlungAbhaengigkeiten {
  uhr: Uhr;
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

/** Ohne eigene Tabellen: Was die Sammlung schreibt und liest, gehört tieferen Bereichen. */
export const zugang = (_db: Db) => ({});
export type SammlungKontext = Kontext<SammlungAbhaengigkeiten, ReturnType<typeof zugang>>;
