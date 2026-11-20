/** What the services get; separate from area.ts so no import cycle forms. */
import type { Db } from '../../db/database';
import { mit, type Kontext } from '../infra/bereich';
import * as setAcquisitions from './repository/setAcquisitions';
import type { HouseholdServices } from '../household';
import type { JobsServices } from '../jobQueue';
import type { CatalogServices } from '../catalog';
import type { FinancesServices } from '../finances';
import type { InventoryServices } from '../inventory';
import type { SetsServices } from '../sets';
import type { PartsServices } from '../parts';
import type { MinifigsServices } from '../minifigs';
import type { WantedServices } from '../wanted';
import type { Uhr } from '../infra/uhr';

export interface CollectionDependencies {
  uhr: Uhr;
  db: Db;
  household: HouseholdServices;
  jobQueue: JobsServices;
  catalog: CatalogServices;
  finances: FinancesServices;
  inventory: InventoryServices;
  sets: SetsServices;
  parts: PartsServices;
  minifigs: MinifigsServices;
  wanted: WantedServices;
}

export const access = (db: Db) => ({
  setAcquisitions: { inScope: mit(db)(setAcquisitions.setAcquisitionsInScope) },
});
export type CollectionContext = Kontext<CollectionDependencies, ReturnType<typeof access>>;
