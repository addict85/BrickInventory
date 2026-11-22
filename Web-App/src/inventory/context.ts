/** What the services receive; separate from area.ts so that no import cycle arises. */
import type { Db } from '../../db/database';
import { withValue, withContract, type Context } from '../infra/area';
import type { InventoryReadContract } from './readContract';
import * as holdingExport from './repository/inventoryExport';
import * as shared from './repository/shared';
import * as purchaseAcquisitions from './repository/purchaseAcquisitions';
import * as metrics from './repository/metrics';
import * as storage from './repository/storageLocation';
import * as manualQuantities from './repository/manualQuantities';
import * as backfill from './repository/backfill';
import * as papierkorb from './repository/trash';
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
  bestandExport: {
    partsForCsv: withContract(db, l)(holdingExport.partsForCsv),
    minifigsForCsv: withContract(db, l)(holdingExport.minifigsForCsv),
  },
  gemeinsam: {
    entryMetrics: withContract(db, l)(shared.entryMetrics),
    setsWithComponent: withContract(db, l)(shared.setsWithComponent),
  },
  kaufErfassungen: {
    inCurrencyOfAccount: withValue(db)(purchaseAcquisitions.inCurrencyOfAccount),
  },
  kennzahlen: {
    setNumbers: withContract(db, l)(metrics.setNumbers),
    instructionNumbers: withContract(db, l)(metrics.instructionNumbers),
    partsInInventory: withContract(db, l)(metrics.partsInInventory),
    partsSingle: withContract(db, l)(metrics.partsSingle),
    minifigsInInventory: withContract(db, l)(metrics.minifigsInInventory),
  },
  lagerort: {
    otherLocationSameNamed: withValue(db)(storage.otherLocationSameNamed),
    removeLocation: withValue(db)(storage.removeLocation),
    addLocationOne: withValue(db)(storage.addLocationOne),
    locationOccupancy: withContract(db, l)(storage.locationOccupancy),
    locationOfAccount: withValue(db)(storage.locationOfAccount),
    ortNachName: withValue(db)(storage.ortNachName),
    ortName: withValue(db)(storage.ortName),
    locationsTheAccounts: withValue(db)(storage.locationsTheAccounts),
    locationsWithInventory: withContract(db, l)(storage.locationsWithInventory),
    writeLocationNames: withValue(db)(storage.writeLocationNames),
  },
  manuelleMengen: {
    sumTheEntries: withValue(db)(manualQuantities.sumTheEntries),
  },
  nachtrag: {
    setEntriesWithoutPrice: withContract(db, l)(backfill.setEntriesWithoutPrice),
    partEntriesWithoutPrice: withContract(db, l)(backfill.partEntriesWithoutPrice),
    minifigEntriesWithoutPrice: withContract(db, l)(backfill.minifigEntriesWithoutPrice),
  },
  papierkorb: {
    eintraege: withValue(db)(papierkorb.entries),
    removeOlder: withValue(db)(papierkorb.removeOlder),
    removeAll: withValue(db)(papierkorb.removeAll),
    removeEntryOfAccount: withValue(db)(papierkorb.removeEntryOfAccount),
  },
});
export type InventoryContext = Context<InventoryDependencies, ReturnType<typeof access>>;
