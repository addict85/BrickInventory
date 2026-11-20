/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Db } from '../../db/database';
import { mit, withContract, type Kontext } from '../infra/bereich';
import type { InventoryReadContract } from './lesevertrag';
import * as bestandExport from './repository/bestandExport';
import * as gemeinsam from './repository/gemeinsam';
import * as kaufErfassungen from './repository/kaufErfassungen';
import * as kennzahlen from './repository/kennzahlen';
import * as lagerort from './repository/lagerort';
import * as manuelleMengen from './repository/manuelleMengen';
import * as nachtrag from './repository/nachtrag';
import * as papierkorb from './repository/papierkorb';
import type { SettingsServices } from '../settings';
import type { HouseholdServices } from '../haushalt';
import type { AccountServices } from '../konto';
import type { CatalogServices } from '../katalog';
import type { FinancesServices } from '../finanzen';
import type { Uhr } from '../infra/uhr';

export interface InventoryDependencies {
  uhr: Uhr;
  db: Db;
  einstellungen: SettingsServices;
  haushalt: HouseholdServices;
  konto: AccountServices;
  katalog: CatalogServices;
  finanzen: FinancesServices;
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
