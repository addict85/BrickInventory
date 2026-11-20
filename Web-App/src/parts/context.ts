/** What the services get; separate from area.ts so no import cycle forms. */
import type { Db } from '../../db/database';
import type { Faecher } from '../infra/zwischenspeicher';
import { mit, type Kontext } from '../infra/bereich';
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
import type { Uhr } from '../infra/uhr';

export interface PartsDependencies {
  uhr: Uhr;
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
    manualPartRow: mit(db)(manualParts.manualPartRow),
    manualPartWithCondition: mit(db)(manualParts.manualPartWithCondition),
    rbColorHex: mit(db)(manualParts.rbColorHex),
    partAcquisitions: mit(db)(manualParts.partAcquisitions),
  },
  partsList: {
    ownedMinifigs: mit(db)(partsList.ownedMinifigs),
    ownedParts: mit(db)(partsList.ownedParts),
    stockColors: mit(db)(partsList.stockColors),
    usedManualParts: mit(db)(partsList.usedManualParts),
    hasUnseenBlNumber: mit(db)(partsList.hasUnseenBlNumber),
    inventoryAsParts: mit(db)(partsList.inventoryAsParts),
    categories: mit(db)(partsList.categories),
    stats: mit(db)(partsList.stats),
    manualParts: mit(db)(partsList.manualParts),
    pageFromSummary: mit(db)(partsList.pageFromSummary),
    pageLive: mit(db)(partsList.pageLive),
  },
  summary: {
    analyze: mit(db)(summary.analyze),
    builtState: mit(db)(summary.builtState),
    rawState: mit(db)(summary.rawState),
  },
  partColor: {
    rbColor: mit(db)(partColor.rbColor),
  },
});
export type PartsContext = Kontext<PartsDependencies, ReturnType<typeof access>>;
