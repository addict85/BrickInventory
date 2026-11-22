/** What the services receive; separate from area.ts so that no import cycle arises. */
import type { AppConfig } from '../infra/config';
import type { MailServices } from '../mail';
import type { Db } from '../../db/database';
import { bound, withContract, type Context } from '../infra/area';
import type { FinancesReadContract } from './readContract';
import type { Compartments } from '../infra/cache';
import * as valuation from './repository/valuation';
import * as acquisitions from './repository/acquisitions';
import * as profitLoss from './repository/profitLoss';
import * as marketPrices from './repository/marketPrices';
import * as portfolioCurve from './repository/portfolioCurve';
import * as priceAlerts from './repository/priceAlerts';
import * as priceCache from './repository/priceCache';
import * as priceRun from './repository/priceRun';
import * as priceHistory from './repository/priceHistory';
import * as setWert from './repository/setValue';
import * as exchangeRates from './repository/exchangeRates';
import type { SettingsServices } from '../settings';
import type { HouseholdServices } from '../household';
import type { CatalogServices } from '../catalog';
import type { JobsServices } from '../jobQueue';
import type { ForeignSourcesServices } from '../externalSources';
import type { Clock } from '../infra/clock';

export interface FinancesDependencies {
  uhr: Clock;
  konfig: Readonly<AppConfig>;
  db: Db;
  einstellungen: SettingsServices;
  jobQueue: JobsServices;
  household: HouseholdServices;
  catalog: CatalogServices;
  externalSources: ForeignSourcesServices;
  faecher: Compartments;
  mail: MailServices;
  lesevertrag: FinancesReadContract;
}

/** Valuation, acquisitions, profit and market prices. */
const holdingAccess = (db: Db, l: FinancesReadContract) => ({
  bewertung: {
    manualEntries: withContract(db, l)(valuation.manualEntries),
    setsToValuation: withContract(db, l)(valuation.setsToValuation),
    catalogFeatures: bound(db)(valuation.catalogFeatures),
    manualMinifigsToValuation: withContract(db, l)(valuation.manualMinifigsToValuation),
    manualPartsToValuation: withContract(db, l)(valuation.manualPartsToValuation),
  },
  erfassungen: {
    loadSetEntries: withContract(db, l)(acquisitions.loadSetEntries),
  },
  gewinnVerlust: {
    setsWithEntries: withContract(db, l)(profitLoss.setsWithEntries),
    freshMarketPrices: bound(db)(profitLoss.freshMarketPrices),
    lastMarketPricesFromHistory: bound(db)(profitLoss.lastMarketPricesFromHistory),
  },
  marktpreise: {
    setPriceFromCache: bound(db)(marketPrices.setPriceFromCache),
    partEntryState: withContract(db, l)(marketPrices.partEntryState),
    minifigEntryState: withContract(db, l)(marketPrices.minifigEntryState),
    minifigsPricesFromCache: bound(db)(marketPrices.minifigsPricesFromCache),
    partsPricesFromCache: bound(db)(marketPrices.partsPricesFromCache),
    estimatedMinifigsPrices: bound(db)(marketPrices.estimatedMinifigsPrices),
    estimatedMinifigsPrice: bound(db)(marketPrices.estimatedMinifigsPrice),
    rememberEstimatedMinifigsPrice: bound(db)(marketPrices.rememberEstimatedMinifigsPrice),
    rememberEstimatedMinifigsHistory: bound(db)(marketPrices.rememberEstimatedMinifigsHistory),
  },
  portfolioKurve: {
    dailyValuesFromHistory: bound(db)(portfolioCurve.dailyValuesFromHistory),
    cachePricesTheSets: bound(db)(portfolioCurve.cachePricesTheSets),
    lastValuesBeforeStart: bound(db)(portfolioCurve.lastValuesBeforeStart),
    setsWithPurchaseTotal: withContract(db, l)(portfolioCurve.setsWithPurchaseTotal),
  },
});

/** Alerts, price cache, price run and exchange rates. */
const priceAccess = (db: Db, l: FinancesReadContract) => ({
  preisalarme: {
    transferAlarm: bound(db)(priceAlerts.transferAlarm),
    writeAlarm: bound(db)(priceAlerts.writeAlarm),
    removeAlarm: bound(db)(priceAlerts.removeAlarm),
    alertsOfSets: withContract(db, l)(priceAlerts.alertsOfSets),
    alertsInScope: withContract(db, l)(priceAlerts.alertsInScope),
    databaseNow: bound(db)(priceAlerts.databaseNow),
    alertsOfAccount: withContract(db, l)(priceAlerts.alertsOfAccount),
    allActiveAlerts: bound(db)(priceAlerts.allActiveAlerts),
    cachePriceForAlarm: bound(db)(priceAlerts.cachePriceForAlarm),
    setAlarmBack: bound(db)(priceAlerts.setAlarmBack),
    resolveAlarmFrom: bound(db)(priceAlerts.resolveAlarmFrom),
    setNameFromMaster: bound(db)(priceAlerts.setNameFromMaster),
    alertsForExport: bound(db)(priceAlerts.alertsForExport),
  },
  preisCache: {
    setStateCounter: withContract(db, l)(priceCache.setStateCounter),
    deleteAllSetPrices: bound(db)(priceCache.deleteAllSetPrices),
    setPriceFresh: bound(db)(priceCache.setPriceFresh),
    setPricesFresh: bound(db)(priceCache.setPricesFresh),
    rememberSetPrice: bound(db)(priceCache.rememberSetPrice),
    rememberSetHistory: bound(db)(priceCache.rememberSetHistory),
    blColors: bound(db)(priceCache.blColors),
    partsPricesFresh: bound(db)(priceCache.partsPricesFresh),
    marketPriceFromCache: bound(db)(priceCache.marketPriceFromCache),
    marketPriceFromHistory: bound(db)(priceCache.marketPriceFromHistory),
    minifigsPricesFresh: bound(db)(priceCache.minifigsPricesFresh),
    partPriceFresh: bound(db)(priceCache.partPriceFresh),
    minifigPriceFresh: bound(db)(priceCache.minifigPriceFresh),
    rememberPartPrice: bound(db)(priceCache.rememberPartPrice),
    rememberPartHistory: bound(db)(priceCache.rememberPartHistory),
    rememberMinifigPrice: bound(db)(priceCache.rememberMinifigPrice),
    rememberMinifigHistory: bound(db)(priceCache.rememberMinifigHistory),
  },
  preisLauf: {
    inventoryPlaces: withContract(db, l)(priceRun.inventoryPlaces),
    wantedListsPlaces: withContract(db, l)(priceRun.wantedListsPlaces),
    recordedStates: withContract(db, l)(priceRun.recordedStates),
    desiredStates: withContract(db, l)(priceRun.desiredStates),
    writeDailyStatus: bound(db)(priceRun.writeDailyStatus),
    setsWithAlarm: bound(db)(priceRun.setsWithAlarm),
  },
  preisverlauf: {
    dailyPricesOfSets: bound(db)(priceHistory.dailyPricesOfSets),
    cachePricesOfSets: bound(db)(priceHistory.cachePricesOfSets),
    firstPurchaseOfSets: withContract(db, l)(priceHistory.firstPurchaseOfSets),
    purchaseAverageOfSets: withContract(db, l)(priceHistory.purchaseAverageOfSets),
    deleteOldHistory: bound(db)(priceHistory.deleteOldHistory),
    manualSeries: bound(db)(priceHistory.manualSeries),
    cachePricesAfterKey: bound(db)(priceHistory.cachePricesAfterKey),
    purchaseAveragesByKey: withContract(db, l)(priceHistory.purchaseAveragesByKey),
  },
  setWert: {
    cachePricesForSets: bound(db)(setWert.cachePricesForSets),
    setEntriesToValue: withContract(db, l)(setWert.setEntriesToValue),
  },
  wechselkurse: {
    writeRates: bound(db)(exchangeRates.writeRates),
    givesEsRates: bound(db)(exchangeRates.givesEsRates),
  },
});

export const access = (db: Db, l: FinancesReadContract) => ({ ...holdingAccess(db, l), ...priceAccess(db, l) });
export type FinancesContext = Context<FinancesDependencies, ReturnType<typeof access>>;
