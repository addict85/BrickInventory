/** What the services receive; separate from area.ts so that no import cycle arises. */
import type { Db } from '../../db/database';
import { mit, withContract, type Kontext } from '../infra/area';
import type { InventoryReadContract } from './readContract';
import * as bestandExport from './repository/inventoryExport';
import * as gemeinsam from './repository/shared';
import * as kaufErfassungen from './repository/purchaseAcquisitions';
import * as kennzahlen from './repository/metrics';
import * as lagerort from './repository/storageLocation';
import * as manuelleMengen from './repository/manualQuantities';
import * as nachtrag from './repository/backfill';
import * as papierkorb from './repository/trash';
import type { SettingsServices } from '../settings';
import type { HouseholdServices } from '../household';
import type { AccountServices } from '../account';
import type { CatalogServices } from '../catalog';
import type { FinancesServices } from '../finances';
import type { Uhr } from '../infra/clock';

export interface InventoryDependencies {
  uhr: Uhr;
  db: Db;
  einstellungen: SettingsServices;
  household: HouseholdServices;
  account: AccountServices;
  catalog: CatalogServices;
  finances: FinancesServices;
  lesevertrag: InventoryReadContract;
}

export const zugang = (db: Db, l: InventoryReadContract) => ({
  bestandExport: {
    partsForCsv: withContract(db, l)(bestandExport.partsForCsv),
    minifigsForCsv: withContract(db, l)(bestandExport.minifigsForCsv),
  },
  gemeinsam: {
    entryMetrics: withContract(db, l)(gemeinsam.entryMetrics),
    setsWithComponent: withContract(db, l)(gemeinsam.setsWithComponent),
  },
  kaufErfassungen: {
    inCurrencyOfAccount: mit(db)(kaufErfassungen.inCurrencyOfAccount),
  },
  kennzahlen: {
    setNumbers: withContract(db, l)(kennzahlen.setNumbers),
    instructionNumbers: withContract(db, l)(kennzahlen.instructionNumbers),
    partsInInventory: withContract(db, l)(kennzahlen.partsInInventory),
    partsSingle: withContract(db, l)(kennzahlen.partsSingle),
    minifigsInInventory: withContract(db, l)(kennzahlen.minifigsInInventory),
  },
  lagerort: {
    otherLocationSameNamed: mit(db)(lagerort.otherLocationSameNamed),
    removeLocation: mit(db)(lagerort.removeLocation),
    addLocationOne: mit(db)(lagerort.addLocationOne),
    locationOccupancy: withContract(db, l)(lagerort.locationOccupancy),
    locationOfAccount: mit(db)(lagerort.locationOfAccount),
    ortNachName: mit(db)(lagerort.ortNachName),
    ortName: mit(db)(lagerort.ortName),
    locationsTheAccounts: mit(db)(lagerort.locationsTheAccounts),
    locationsWithInventory: withContract(db, l)(lagerort.locationsWithInventory),
    writeLocationNames: mit(db)(lagerort.writeLocationNames),
  },
  manuelleMengen: {
    sumTheEntries: mit(db)(manuelleMengen.sumTheEntries),
  },
  nachtrag: {
    setEntriesWithoutPrice: withContract(db, l)(nachtrag.setEntriesWithoutPrice),
    partEntriesWithoutPrice: withContract(db, l)(nachtrag.partEntriesWithoutPrice),
    minifigEntriesWithoutPrice: withContract(db, l)(nachtrag.minifigEntriesWithoutPrice),
  },
  papierkorb: {
    eintraege: mit(db)(papierkorb.eintraege),
    removeOlder: mit(db)(papierkorb.removeOlder),
    removeAll: mit(db)(papierkorb.removeAll),
    removeEntryOfAccount: mit(db)(papierkorb.removeEntryOfAccount),
  },
});
export type InventoryContext = Kontext<InventoryDependencies, ReturnType<typeof zugang>>;
