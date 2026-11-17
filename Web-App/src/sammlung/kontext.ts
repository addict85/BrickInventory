/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Db } from '../../db/database';
import { mit, type Kontext } from '../infra/bereich';
import * as setErfassungen from './repository/setErfassungen';
import type { HaushaltDienste } from '../haushalt';
import type { AuftraegeDienste } from '../auftraege';
import type { KatalogDienste } from '../katalog';
import type { FinanzenDienste } from '../finanzen';
import type { BestandDienste } from '../bestand';
import type { SetsDienste } from '../sets';
import type { TeileDienste } from '../teile';
import type { MinifigsServices } from '../minifigs';
import type { WantedServices } from '../wanted';
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
  minifigs: MinifigsServices;
  wanted: WantedServices;
}

export const zugang = (db: Db) => ({
  setKaeufe: { imBlickfeld: mit(db)(setErfassungen.setErfassungenImBlickfeld) },
});
export type SammlungKontext = Kontext<SammlungAbhaengigkeiten, ReturnType<typeof zugang>>;
