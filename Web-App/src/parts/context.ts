/** What the services get; separate from area.ts so no import cycle forms. */
import type { Db } from '../../db/database';
import type { Compartments } from '../infra/cache';
import { bound, type Context } from '../infra/area';
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
  clock: Clock;
  db: Db;
  /** State per access (rebuilding the parts summary); createParts sets it up. */
  compartments: Compartments;
  settings: SettingsServices;
  jobQueue: JobsServices;
  household: HouseholdServices;
  catalog: CatalogServices;
  externalSources: ForeignSourcesServices;
  finances: FinancesServices;
  inventory: InventoryServices;
}

export const access = (db: Db) => ({
  manualParts: {
    manualPartRow: bound(db)(manualParts.manualPartRow),
    manualPartWithCondition: bound(db)(manualParts.manualPartWithCondition),
    rbColorHex: bound(db)(manualParts.rbColorHex),
    partAcquisitions: bound(db)(manualParts.partAcquisitions),
  },
  partsList: {
    ownedMinifigs: bound(db)(partsList.ownedMinifigs),
    ownedParts: bound(db)(partsList.ownedParts),
    stockColors: bound(db)(partsList.stockColors),
    usedManualParts: bound(db)(partsList.usedManualParts),
    hasUnseenBlNumber: bound(db)(partsList.hasUnseenBlNumber),
    inventoryAsParts: bound(db)(partsList.inventoryAsParts),
    categories: bound(db)(partsList.categories),
    stats: bound(db)(partsList.stats),
    manualParts: bound(db)(partsList.manualParts),
    pageFromSummary: bound(db)(partsList.pageFromSummary),
    pageLive: bound(db)(partsList.pageLive),
  },
  summary: {
    analyze: bound(db)(summary.analyze),
    builtState: bound(db)(summary.builtState),
    rawState: bound(db)(summary.rawState),
  },
  partColor: {
    rbColor: bound(db)(partColor.rbColor),
  },
});
export type PartsContext = Context<PartsDependencies, ReturnType<typeof access>>;
