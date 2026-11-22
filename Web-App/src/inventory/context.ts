/** What the services receive; separate from area.ts so that no import cycle arises. */
import type { Db } from '../../db/database';
import { bound, withContract, type Context } from '../infra/area';
import type { InventoryReadContract } from './readContract';
import * as holdingExport from './repository/inventoryExport';
import * as shared from './repository/shared';
import * as purchaseAcquisitions from './repository/purchaseAcquisitions';
import * as metrics from './repository/metrics';
import * as storage from './repository/storageLocation';
import * as manualQuantities from './repository/manualQuantities';
import * as backfill from './repository/backfill';
import * as trash from './repository/trash';
import type { SettingsServices } from '../settings';
import type { HouseholdServices } from '../household';
import type { AccountServices } from '../account';
import type { CatalogServices } from '../catalog';
import type { FinancesServices } from '../finances';
import type { Clock } from '../infra/clock';

export interface InventoryDependencies {
  uhr: Clock;
  db: Db;
  einstellungen: SettingsServices;
  household: HouseholdServices;
  account: AccountServices;
  catalog: CatalogServices;
  finances: FinancesServices;
  lesevertrag: InventoryReadContract;
}

export const access = (db: Db, l: InventoryReadContract) => ({
  holdingExport: {
    partsForCsv: withContract(db, l)(holdingExport.partsForCsv),
    minifigsForCsv: withContract(db, l)(holdingExport.minifigsForCsv),
  },
  shared: {
    entryMetrics: withContract(db, l)(shared.entryMetrics),
    setsWithComponent: withContract(db, l)(shared.setsWithComponent),
  },
  purchaseAcquisitions: {
    inCurrencyOfAccount: bound(db)(purchaseAcquisitions.inCurrencyOfAccount),
  },
  metrics: {
    setNumbers: withContract(db, l)(metrics.setNumbers),
    instructionNumbers: withContract(db, l)(metrics.instructionNumbers),
    partsInInventory: withContract(db, l)(metrics.partsInInventory),
    partsSingle: withContract(db, l)(metrics.partsSingle),
    minifigsInInventory: withContract(db, l)(metrics.minifigsInInventory),
  },
  storage: {
    otherLocationSameNamed: bound(db)(storage.otherLocationSameNamed),
    removeLocation: bound(db)(storage.removeLocation),
    addLocationOne: bound(db)(storage.addLocationOne),
    locationOccupancy: withContract(db, l)(storage.locationOccupancy),
    locationOfAccount: bound(db)(storage.locationOfAccount),
    storageByName: bound(db)(storage.ortNachName),
    ortName: bound(db)(storage.ortName),
    locationsTheAccounts: bound(db)(storage.locationsTheAccounts),
    locationsWithInventory: withContract(db, l)(storage.locationsWithInventory),
    writeLocationNames: bound(db)(storage.writeLocationNames),
  },
  manualQuantities: {
    sumTheEntries: bound(db)(manualQuantities.sumTheEntries),
  },
  backfill: {
    setEntriesWithoutPrice: withContract(db, l)(backfill.setEntriesWithoutPrice),
    partEntriesWithoutPrice: withContract(db, l)(backfill.partEntriesWithoutPrice),
    minifigEntriesWithoutPrice: withContract(db, l)(backfill.minifigEntriesWithoutPrice),
  },
  trash: {
    entries: bound(db)(trash.entries),
    removeOlder: bound(db)(trash.removeOlder),
    removeAll: bound(db)(trash.removeAll),
    removeEntryOfAccount: bound(db)(trash.removeEntryOfAccount),
  },
});
export type InventoryContext = Context<InventoryDependencies, ReturnType<typeof access>>;
