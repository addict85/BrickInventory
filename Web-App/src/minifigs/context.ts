/** What the services get; separate from area.ts so no import cycle forms. */
import type { Db } from '../../db/database';
import { withValue, type Context } from '../infra/area';
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
    groupedMinifigs: withValue(db)(minifigsList.groupedMinifigs),
    manualMinifigsList: withValue(db)(minifigsList.manualMinifigsList),
    conditionCountsOfManualMinifigs: withValue(db)(minifigsList.conditionCountsOfManualMinifigs),
    minifigStats: withValue(db)(minifigsList.minifigStats),
  },
  minifigParts: {
    catalogPartsOfMinifig: withValue(db)(minifigParts.catalogPartsOfMinifig),
    inventoryPartsOfMinifig: withValue(db)(minifigParts.inventoryPartsOfMinifig),
    setWithMinifig: withValue(db)(minifigParts.setWithMinifig),
  },
  manualMinifigs: {
    manualMinifigRow: withValue(db)(manualMinifigs.manualMinifigRow),
    minifigRowWithCondition: withValue(db)(manualMinifigs.minifigRowWithCondition),
    minifigAcquisitions: withValue(db)(manualMinifigs.minifigAcquisitions),
  },
});
export type MinifigsContext = Context<MinifigsDependencies, ReturnType<typeof access>>;
