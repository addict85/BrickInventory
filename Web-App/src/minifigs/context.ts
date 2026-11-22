/** What the services get; separate from area.ts so no import cycle forms. */
import type { Db } from '../../db/database';
import { bound, type Context } from '../infra/area';
import * as minifigsList from './repository/minifigsList';
import * as minifigParts from './repository/minifigParts';
import * as manualMinifigs from './repository/manualMinifigs';
import type { SettingsServices } from '../settings';
import type { HouseholdServices } from '../household';
import type { CatalogServices } from '../catalog';
import type { FinancesServices } from '../finances';
import type { InventoryServices } from '../inventory';
import type { JobsServices } from '../jobQueue';
import type { ForeignSourcesServices } from '../externalSources';
import type { Clock } from '../infra/clock';

export interface MinifigsDependencies {
  uhr: Clock;
  db: Db;
  einstellungen: SettingsServices;
  household: HouseholdServices;
  catalog: CatalogServices;
  finances: FinancesServices;
  inventory: InventoryServices;
  externalSources: ForeignSourcesServices;
  jobQueue: JobsServices;
}

export const access = (db: Db) => ({
  minifigsList: {
    groupedMinifigs: bound(db)(minifigsList.groupedMinifigs),
    manualMinifigsList: bound(db)(minifigsList.manualMinifigsList),
    conditionCountsOfManualMinifigs: bound(db)(minifigsList.conditionCountsOfManualMinifigs),
    minifigStats: bound(db)(minifigsList.minifigStats),
  },
  minifigParts: {
    catalogPartsOfMinifig: bound(db)(minifigParts.catalogPartsOfMinifig),
    inventoryPartsOfMinifig: bound(db)(minifigParts.inventoryPartsOfMinifig),
    setWithMinifig: bound(db)(minifigParts.setWithMinifig),
  },
  manualMinifigs: {
    manualMinifigRow: bound(db)(manualMinifigs.manualMinifigRow),
    minifigRowWithCondition: bound(db)(manualMinifigs.minifigRowWithCondition),
    minifigAcquisitions: bound(db)(manualMinifigs.minifigAcquisitions),
  },
});
export type MinifigsContext = Context<MinifigsDependencies, ReturnType<typeof access>>;
