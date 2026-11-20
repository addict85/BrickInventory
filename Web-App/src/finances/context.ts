/** What the services receive; separate from area.ts so that no import cycle arises. */
import type { Konfig } from '../infra/config';
import type { MailServices } from '../mail';
import type { Db } from '../../db/database';
import { mit, withContract, type Kontext } from '../infra/area';
import type { FinancesReadContract } from './readContract';
import type { Faecher } from '../infra/cache';
import * as bewertung from './repository/valuation';
import * as erfassungen from './repository/acquisitions';
import * as gewinnVerlust from './repository/profitLoss';
import * as marktpreise from './repository/marketPrices';
import * as portfolioKurve from './repository/portfolioCurve';
import * as preisalarme from './repository/priceAlerts';
import * as preisCache from './repository/priceCache';
import * as preisLauf from './repository/priceRun';
import * as preisverlauf from './repository/priceHistory';
import * as setWert from './repository/setValue';
import * as wechselkurse from './repository/exchangeRates';
import type { SettingsServices } from '../settings';
import type { HouseholdServices } from '../household';
import type { CatalogServices } from '../catalog';
import type { JobsServices } from '../jobQueue';
import type { ForeignSourcesServices } from '../externalSources';
import type { Uhr } from '../infra/clock';

export interface FinancesDependencies {
  uhr: Uhr;
  konfig: Readonly<Konfig>;
  db: Db;
  einstellungen: SettingsServices;
  jobQueue: JobsServices;
  household: HouseholdServices;
  catalog: CatalogServices;
  externalSources: ForeignSourcesServices;
  faecher: Faecher;
  mail: MailServices;
  lesevertrag: FinancesReadContract;
}

/** Valuation, acquisitions, profit and market prices. */
const bestandszugang = (db: Db, l: FinancesReadContract) => ({
  bewertung: {
    manualEntries: withContract(db, l)(bewertung.manualEntries),
    setsToValuation: withContract(db, l)(bewertung.setsToValuation),
    catalogFeatures: mit(db)(bewertung.catalogFeatures),
    manualMinifigsToValuation: withContract(db, l)(bewertung.manualMinifigsToValuation),
    manualPartsToValuation: withContract(db, l)(bewertung.manualPartsToValuation),
  },
  erfassungen: {
    loadSetEntries: withContract(db, l)(erfassungen.loadSetEntries),
  },
  gewinnVerlust: {
    setsWithEntries: withContract(db, l)(gewinnVerlust.setsWithEntries),
    freshMarketPrices: mit(db)(gewinnVerlust.freshMarketPrices),
    lastMarketPricesFromHistory: mit(db)(gewinnVerlust.lastMarketPricesFromHistory),
  },
  marktpreise: {
    setPriceFromCache: mit(db)(marktpreise.setPriceFromCache),
    partEntryState: withContract(db, l)(marktpreise.partEntryState),
    minifigEntryState: withContract(db, l)(marktpreise.minifigEntryState),
    minifigsPricesFromCache: mit(db)(marktpreise.minifigsPricesFromCache),
    partsPricesFromCache: mit(db)(marktpreise.partsPricesFromCache),
    estimatedMinifigsPrices: mit(db)(marktpreise.estimatedMinifigsPrices),
    estimatedMinifigsPrice: mit(db)(marktpreise.estimatedMinifigsPrice),
    rememberEstimatedMinifigsPrice: mit(db)(marktpreise.rememberEstimatedMinifigsPrice),
    rememberEstimatedMinifigsHistory: mit(db)(marktpreise.rememberEstimatedMinifigsHistory),
  },
  portfolioKurve: {
    dailyValuesFromHistory: mit(db)(portfolioKurve.dailyValuesFromHistory),
    cachePricesTheSets: mit(db)(portfolioKurve.cachePricesTheSets),
    lastValuesBeforeStart: mit(db)(portfolioKurve.lastValuesBeforeStart),
    setsWithPurchaseTotal: withContract(db, l)(portfolioKurve.setsWithPurchaseTotal),
  },
});

/** Alerts, price cache, price run and exchange rates. */
const preiszugang = (db: Db, l: FinancesReadContract) => ({
  preisalarme: {
    transferAlarm: mit(db)(preisalarme.transferAlarm),
    writeAlarm: mit(db)(preisalarme.writeAlarm),
    removeAlarm: mit(db)(preisalarme.removeAlarm),
    alertsOfSets: withContract(db, l)(preisalarme.alertsOfSets),
    alertsInScope: withContract(db, l)(preisalarme.alertsInScope),
    databaseNow: mit(db)(preisalarme.databaseNow),
    alertsOfAccount: withContract(db, l)(preisalarme.alertsOfAccount),
    allActiveAlerts: mit(db)(preisalarme.allActiveAlerts),
    cachePriceForAlarm: mit(db)(preisalarme.cachePriceForAlarm),
    setAlarmBack: mit(db)(preisalarme.setAlarmBack),
    resolveAlarmFrom: mit(db)(preisalarme.resolveAlarmFrom),
    setNameFromMaster: mit(db)(preisalarme.setNameFromMaster),
    alertsForExport: mit(db)(preisalarme.alertsForExport),
  },
  preisCache: {
    setStateCounter: withContract(db, l)(preisCache.setStateCounter),
    deleteAllSetPrices: mit(db)(preisCache.deleteAllSetPrices),
    setPriceFresh: mit(db)(preisCache.setPriceFresh),
    setPricesFresh: mit(db)(preisCache.setPricesFresh),
    rememberSetPrice: mit(db)(preisCache.rememberSetPrice),
    rememberSetHistory: mit(db)(preisCache.rememberSetHistory),
    blFarben: mit(db)(preisCache.blFarben),
    partsPricesFresh: mit(db)(preisCache.partsPricesFresh),
    marketPriceFromCache: mit(db)(preisCache.marketPriceFromCache),
    marketPriceFromHistory: mit(db)(preisCache.marketPriceFromHistory),
    minifigsPricesFresh: mit(db)(preisCache.minifigsPricesFresh),
    partPriceFresh: mit(db)(preisCache.partPriceFresh),
    minifigPriceFresh: mit(db)(preisCache.minifigPriceFresh),
    rememberPartPrice: mit(db)(preisCache.rememberPartPrice),
    rememberPartHistory: mit(db)(preisCache.rememberPartHistory),
    rememberMinifigPrice: mit(db)(preisCache.rememberMinifigPrice),
    rememberMinifigHistory: mit(db)(preisCache.rememberMinifigHistory),
  },
  preisLauf: {
    inventoryPlaces: withContract(db, l)(preisLauf.inventoryPlaces),
    wantedListsPlaces: withContract(db, l)(preisLauf.wantedListsPlaces),
    recordedStates: withContract(db, l)(preisLauf.recordedStates),
    desiredStates: withContract(db, l)(preisLauf.desiredStates),
    writeDailyStatus: mit(db)(preisLauf.writeDailyStatus),
    setsWithAlarm: mit(db)(preisLauf.setsWithAlarm),
  },
  preisverlauf: {
    dailyPricesOfSets: mit(db)(preisverlauf.dailyPricesOfSets),
    cachePricesOfSets: mit(db)(preisverlauf.cachePricesOfSets),
    firstPurchaseOfSets: withContract(db, l)(preisverlauf.firstPurchaseOfSets),
    purchaseChnittOfSets: withContract(db, l)(preisverlauf.purchaseChnittOfSets),
    deleteOldHistory: mit(db)(preisverlauf.deleteOldHistory),
    manualSeries: mit(db)(preisverlauf.manualSeries),
    cachePricesAfterKey: mit(db)(preisverlauf.cachePricesAfterKey),
    purchaseChnitteAfterKey: withContract(db, l)(preisverlauf.purchaseChnitteAfterKey),
  },
  setWert: {
    cachePricesForSets: mit(db)(setWert.cachePricesForSets),
    setEntriesToValue: withContract(db, l)(setWert.setEntriesToValue),
  },
  wechselkurse: {
    writeRates: mit(db)(wechselkurse.writeRates),
    givesEsRates: mit(db)(wechselkurse.givesEsRates),
  },
});

export const zugang = (db: Db, l: FinancesReadContract) => ({ ...bestandszugang(db, l), ...preiszugang(db, l) });
export type FinancesContext = Kontext<FinancesDependencies, ReturnType<typeof zugang>>;
