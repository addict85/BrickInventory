/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import type { Db } from '../../db/database';
import { bound, buildArea, type Inspect } from '../infra/area';
import { Compartments } from '../infra/cache';
import * as marketPrice from './marketPrice';
import * as portfolioHistory from './portfolioHistory';
import * as priceHistory from './priceHistory';
import * as valuationService from './calculation/valuation';
import * as gainLossService from './calculation/profitLoss';
import * as prices from './calculation/prices';
import * as priceRunService from './priceRun';
import * as priceRule from './priceRule';
import { financesJobTypes } from './jobTypes';
import * as exchangeRatesService from './exchangeRates';
import * as priceAlert from './priceAlert';
import { access, type FinancesDependencies, type FinancesContext } from './context';

export type { FinancesDependencies, FinancesContext } from './context';

export function createFinances(a: Omit<FinancesDependencies, 'compartments'>, inspect?: Inspect<FinancesContext>) {
  // The price cache applies per currency: a change requires a full price run.
  a.settings.onCurrencyChange(() => a.jobQueue.pullPlanBefore('prices'));
  return buildArea(
    { ...a, compartments: new Compartments() },
    (db: Db) => access(db, a.readContract),
    (k: FinancesContext) => ({
      // The price alerts are services; the price run calls them via the context.
      priceAlert: {
        alarmTransfer: bound(k)(priceAlert.alarmTransfer),
        alertsFromCsv: bound(k)(priceAlert.alertsFromCsv),
        alertsFor: bound(k)(priceAlert.alertsFor),
        allAlerts: bound(k)(priceAlert.allAlerts),
        triggeredSince: bound(k)(priceAlert.triggeredSince),
        priceAlertsAsCsv: bound(k)(priceAlert.priceAlertsAsCsv),
        deleteAlert: bound(k)(priceAlert.deleteAlert),
        setAlert: bound(k)(priceAlert.setAlert),
      },
      currentMarketPrice: bound(k)(marketPrice.currentMarketPrice),
      marketPriceFromCache: k.priceCache.marketPriceFromCache,
      marketPriceFromHistory: k.priceCache.marketPriceFromHistory,
      partState: bound(k)(marketPrice.partState),
      marketPricesFromCacheForMinifigs: bound(k)(marketPrice.marketPricesFromCacheForMinifigs),
      marketPricesFromCacheForParts: bound(k)(marketPrice.marketPricesFromCacheForParts),
      figMarketPriceWithOrigin: bound(k)(marketPrice.figMarketPriceWithOrigin),
      marketPriceWithOrigin: bound(k)(marketPrice.marketPriceWithOrigin),
      currentMinifigMarketPrice: bound(k)(marketPrice.currentMinifigMarketPrice),
      currentPartMarketPrice: bound(k)(marketPrice.currentPartMarketPrice),
      portfolioHistory: bound(k)(portfolioHistory.portfolioHistory),
      priceHistorySet: bound(k)(priceHistory.priceHistorySet),
      priceHistoryPart: bound(k)(priceHistory.priceHistoryPart),
      priceHistoryMinifig: bound(k)(priceHistory.priceHistoryMinifig),
      deleteOldPrices: bound(k)(priceHistory.deleteOldPrices),
      valueSets: bound(k)(valuationService.valueSets),
      valueMinifigs: bound(k)(valuationService.valueMinifigs),
      valueParts: bound(k)(valuationService.valueParts),
      gainAndLoss: bound(k)(gainLossService.gainAndLoss),
      setState: bound(k)(prices.conditionOfSet),
      emptyPriceCache: bound(k)(prices.emptyPriceCache),
      fetchPrice: bound(k)(prices.fetchPrice),
      colorChart: bound(k)(prices.colorChart),
      fetchPriceForSet: bound(k)(priceRunService.fetchPriceForSet),
      purchasePriceFromInput: bound(k)(priceRule.purchasePriceFromInput),
      manualPurchasePrice: bound(k)(priceRule.manualPurchasePrice),
      scheduleRateFetch: bound(k)(exchangeRatesService.scheduleRateFetch),
      jobKinds: () => financesJobTypes(k),
    }),
    inspect,
  );
}

export type FinancesServices = ReturnType<typeof createFinances>;
