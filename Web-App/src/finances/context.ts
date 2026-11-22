/** What the services receive; separate from area.ts so that no import cycle arises. */
import type { Konfig } from '../infra/config';
import type { MailServices } from '../mail';
import type { Db } from '../../db/database';
import { withValue, withContract, type Context } from '../infra/area';
import type { FinancesReadContract } from './readContract';
import type { Faecher } from '../infra/cache';
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
const holdingAccess = (db: Db, l: FinancesReadContract) => ({
  bewertung: {
    manualEntries: withContract(db, l)(valuation.manualEntries),
    setsToValuation: withContract(db, l)(valuation.setsToValuation),
    catalogFeatures: withValue(db)(valuation.catalogFeatures),
    manualMinifigsToValuation: withContract(db, l)(valuation.manualMinifigsToValuation),
    manualPartsToValuation: withContract(db, l)(valuation.manualPartsToValuation),
  },
  erfassungen: {
    loadSetEntries: withContract(db, l)(acquisitions.loadSetEntries),
  },
  gewinnVerlust: {
    setsWithEntries: withContract(db, l)(profitLoss.setsWithEntries),
    freshMarketPrices: withValue(db)(profitLoss.freshMarketPrices),
    lastMarketPricesFromHistory: withValue(db)(profitLoss.lastMarketPricesFromHistory),
  },
  marktpreise: {
    setPriceFromCache: withValue(db)(marketPrices.setPriceFromCache),
    partEntryState: withContract(db, l)(marketPrices.partEntryState),
    minifigEntryState: withContract(db, l)(marketPrices.minifigEntryState),
    minifigsPricesFromCache: withValue(db)(marketPrices.minifigsPricesFromCache),
    partsPricesFromCache: withValue(db)(marketPrices.partsPricesFromCache),
    estimatedMinifigsPrices: withValue(db)(marketPrices.estimatedMinifigsPrices),
    estimatedMinifigsPrice: withValue(db)(marketPrices.estimatedMinifigsPrice),
    rememberEstimatedMinifigsPrice: withValue(db)(marketPrices.rememberEstimatedMinifigsPrice),
    rememberEstimatedMinifigsHistory: withValue(db)(marketPrices.rememberEstimatedMinifigsHistory),
  },
  portfolioKurve: {
    dailyValuesFromHistory: withValue(db)(portfolioCurve.dailyValuesFromHistory),
    cachePricesTheSets: withValue(db)(portfolioCurve.cachePricesTheSets),
    lastValuesBeforeStart: withValue(db)(portfolioCurve.lastValuesBeforeStart),
    setsWithPurchaseTotal: withContract(db, l)(portfolioCurve.setsWithPurchaseTotal),
  },
});

/** Alerts, price cache, price run and exchange rates. */
const priceAccess = (db: Db, l: FinancesReadContract) => ({
  preisalarme: {
    transferAlarm: withValue(db)(priceAlerts.transferAlarm),
    writeAlarm: withValue(db)(priceAlerts.writeAlarm),
    removeAlarm: withValue(db)(priceAlerts.removeAlarm),
    alertsOfSets: withContract(db, l)(priceAlerts.alertsOfSets),
    alertsInScope: withContract(db, l)(priceAlerts.alertsInScope),
    databaseNow: withValue(db)(priceAlerts.databaseNow),
    alertsOfAccount: withContract(db, l)(priceAlerts.alertsOfAccount),
    allActiveAlerts: withValue(db)(priceAlerts.allActiveAlerts),
    cachePriceForAlarm: withValue(db)(priceAlerts.cachePriceForAlarm),
    setAlarmBack: withValue(db)(priceAlerts.setAlarmBack),
    resolveAlarmFrom: withValue(db)(priceAlerts.resolveAlarmFrom),
    setNameFromMaster: withValue(db)(priceAlerts.setNameFromMaster),
    alertsForExport: withValue(db)(priceAlerts.alertsForExport),
  },
  preisCache: {
    setStateCounter: withContract(db, l)(priceCache.setStateCounter),
    deleteAllSetPrices: withValue(db)(priceCache.deleteAllSetPrices),
    setPriceFresh: withValue(db)(priceCache.setPriceFresh),
    setPricesFresh: withValue(db)(priceCache.setPricesFresh),
    rememberSetPrice: withValue(db)(priceCache.rememberSetPrice),
    rememberSetHistory: withValue(db)(priceCache.rememberSetHistory),
    blFarben: withValue(db)(priceCache.blColors),
    partsPricesFresh: withValue(db)(priceCache.partsPricesFresh),
    marketPriceFromCache: withValue(db)(priceCache.marketPriceFromCache),
    marketPriceFromHistory: withValue(db)(priceCache.marketPriceFromHistory),
    minifigsPricesFresh: withValue(db)(priceCache.minifigsPricesFresh),
    partPriceFresh: withValue(db)(priceCache.partPriceFresh),
    minifigPriceFresh: withValue(db)(priceCache.minifigPriceFresh),
    rememberPartPrice: withValue(db)(priceCache.rememberPartPrice),
    rememberPartHistory: withValue(db)(priceCache.rememberPartHistory),
    rememberMinifigPrice: withValue(db)(priceCache.rememberMinifigPrice),
    rememberMinifigHistory: withValue(db)(priceCache.rememberMinifigHistory),
  },
  preisLauf: {
    inventoryPlaces: withContract(db, l)(priceRun.inventoryPlaces),
    wantedListsPlaces: withContract(db, l)(priceRun.wantedListsPlaces),
    recordedStates: withContract(db, l)(priceRun.recordedStates),
    desiredStates: withContract(db, l)(priceRun.desiredStates),
    writeDailyStatus: withValue(db)(priceRun.writeDailyStatus),
    setsWithAlarm: withValue(db)(priceRun.setsWithAlarm),
  },
  preisverlauf: {
    dailyPricesOfSets: withValue(db)(priceHistory.dailyPricesOfSets),
    cachePricesOfSets: withValue(db)(priceHistory.cachePricesOfSets),
    firstPurchaseOfSets: withContract(db, l)(priceHistory.firstPurchaseOfSets),
    purchaseChnittOfSets: withContract(db, l)(priceHistory.purchaseAverageOfSets),
    deleteOldHistory: withValue(db)(priceHistory.deleteOldHistory),
    manualSeries: withValue(db)(priceHistory.manualSeries),
    cachePricesAfterKey: withValue(db)(priceHistory.cachePricesAfterKey),
    purchaseChnitteAfterKey: withContract(db, l)(priceHistory.purchaseAveragesByKey),
  },
  setWert: {
    cachePricesForSets: withValue(db)(setWert.cachePricesForSets),
    setEntriesToValue: withContract(db, l)(setWert.setEntriesToValue),
  },
  wechselkurse: {
    writeRates: withValue(db)(exchangeRates.writeRates),
    givesEsRates: withValue(db)(exchangeRates.givesEsRates),
  },
});

export const access = (db: Db, l: FinancesReadContract) => ({ ...holdingAccess(db, l), ...priceAccess(db, l) });
export type FinancesContext = Context<FinancesDependencies, ReturnType<typeof access>>;
