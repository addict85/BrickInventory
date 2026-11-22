/** What the services get; separate from area.ts so no import cycle forms. */
import type { Db } from '../../db/database';
import type { Faecher } from '../infra/cache';
import { withValue, type Context } from '../infra/area';
import * as manualParts from './repository/manualParts';
import * as partsList from './repository/partsList';
import * as summary from './repository/summary';
import * as partColor from './repository/partColor';
import type { JobsServices } from '../jobQueue';
import type { SettingsServices } from '../settings';
import type { HouseholdServices } from '../household';
import type { CatalogServices } from '../catalog';
import type { ForeignSourcesServices } from '../externalSources';
import type { FinancesServices } from '../finances';
import type { InventoryServices } from '../inventory';
import type { Clock } from '../infra/clock';

export interface PartsDependencies {
  uhr: Clock;
  db: Db;
  /** State per access (rebuilding the parts summary); createParts sets it up. */
  faecher: Faecher;
  einstellungen: SettingsServices;
  jobQueue: JobsServices;
  household: HouseholdServices;
  catalog: CatalogServices;
  externalSources: ForeignSourcesServices;
  finances: FinancesServices;
  inventory: InventoryServices;
}

export const access = (db: Db) => ({
  manualParts: {
    manualPartRow: withValue(db)(manualParts.manualPartRow),
    manualPartWithCondition: withValue(db)(manualParts.manualPartWithCondition),
    rbColorHex: withValue(db)(manualParts.rbColorHex),
    partAcquisitions: withValue(db)(manualParts.partAcquisitions),
  },
  partsList: {
    ownedMinifigs: withValue(db)(partsList.ownedMinifigs),
    ownedParts: withValue(db)(partsList.ownedParts),
    stockColors: withValue(db)(partsList.stockColors),
    usedManualParts: withValue(db)(partsList.usedManualParts),
    hasUnseenBlNumber: withValue(db)(partsList.hasUnseenBlNumber),
    inventoryAsParts: withValue(db)(partsList.inventoryAsParts),
    categories: withValue(db)(partsList.categories),
    stats: withValue(db)(partsList.stats),
    manualParts: withValue(db)(partsList.manualParts),
    pageFromSummary: withValue(db)(partsList.pageFromSummary),
    pageLive: withValue(db)(partsList.pageLive),
  },
  summary: {
    analyze: withValue(db)(summary.analyze),
    builtState: withValue(db)(summary.builtState),
    rawState: withValue(db)(summary.rawState),
  },
  partColor: {
    rbColor: withValue(db)(partColor.rbColor),
  },
});
export type PartsContext = Context<PartsDependencies, ReturnType<typeof access>>;
