/** What the services get; separate from area.ts so no import cycle forms. */
import type { Db } from '../../db/database';
import { mit, type Kontext } from '../infra/bereich';
import * as setAcquisitions from './repository/setAcquisitions';
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

export interface CollectionDependencies {
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

export const access = (db: Db) => ({
  setAcquisitions: { inScope: mit(db)(setAcquisitions.setAcquisitionsInScope) },
});
export type CollectionContext = Kontext<CollectionDependencies, ReturnType<typeof access>>;
