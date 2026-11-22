/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import type { Db } from '../../db/database';
import { withValue, buildArea, type Inspect } from '../infra/area';
import { Faecher } from '../infra/cache';
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

export function createFinances(a: Omit<FinancesDependencies, 'faecher'>, inspect?: Inspect<FinancesContext>) {
  // The price cache applies per currency: a change requires a full price run.
  a.einstellungen.onCurrencyChange(() => a.jobQueue.pullPlanBefore('preise'));
  return buildArea(
    { ...a, faecher: new Faecher() },
    (db: Db) => access(db, a.lesevertrag),
    (k: FinancesContext) => ({
      // The price alerts are services; the price run calls them via the context.
      preisalarm: {
        alarmTransfer: withValue(k)(priceAlert.alarmTransfer),
        alertsFromCsv: withValue(k)(priceAlert.alertsFromCsv),
        alertsFor: withValue(k)(priceAlert.alertsFor),
        alleAlarme: withValue(k)(priceAlert.allAlerts),
        triggeredSince: withValue(k)(priceAlert.triggeredSince),
        preisalarmeAlsCsv: withValue(k)(priceAlert.priceAlertsAsCsv),
        loescheAlarm: withValue(k)(priceAlert.deleteAlert),
        setzeAlarm: withValue(k)(priceAlert.setAlert),
      },
      aktuellerMarktpreis: withValue(k)(marketPrice.aktuellerMarktpreis),
      marketPriceFromCache: k.preisCache.marketPriceFromCache,
      marketPriceFromHistory: k.preisCache.marketPriceFromHistory,
      partState: withValue(k)(marketPrice.partState),
      marketPricesFromCacheForMinifigs: withValue(k)(marketPrice.marketPricesFromCacheForMinifigs),
      marketPricesFromCacheForParts: withValue(k)(marketPrice.marketPricesFromCacheForParts),
      figMarketPriceWithOrigin: withValue(k)(marketPrice.figMarketPriceWithOrigin),
      marketPriceWithOrigin: withValue(k)(marketPrice.marketPriceWithOrigin),
      currentMinifigMarketPrice: withValue(k)(marketPrice.currentMinifigMarketPrice),
      currentPartMarketPrice: withValue(k)(marketPrice.currentPartMarketPrice),
      portfolioVerlauf: withValue(k)(portfolioHistory.portfolioVerlauf),
      priceHistorySet: withValue(k)(priceHistory.priceHistorySet),
      priceHistoryPart: withValue(k)(priceHistory.priceHistoryPart),
      priceHistoryMinifig: withValue(k)(priceHistory.priceHistoryMinifig),
      deleteOldPrices: withValue(k)(priceHistory.deleteOldPrices),
      valueSets: withValue(k)(valuationService.valueSets),
      valueMinifigs: withValue(k)(valuationService.valueMinifigs),
      valueParts: withValue(k)(valuationService.valueParts),
      gainAndLoss: withValue(k)(gainLossService.gainAndLoss),
      setState: withValue(k)(prices.setState),
      emptyPriceCache: withValue(k)(prices.emptyPriceCache),
      fetchPrice: withValue(k)(prices.fetchPrice),
      farbkarte: withValue(k)(prices.colorChart),
      preisFuerSetHolen: withValue(k)(priceRunService.preisFuerSetHolen),
      purchasePriceFromInput: withValue(k)(priceRule.purchasePriceFromInput),
      manuellerKaufpreis: withValue(k)(priceRule.manualPurchasePrice),
      planeKursabruf: withValue(k)(exchangeRatesService.scheduleRateFetch),
      auftragsarten: () => financesJobTypes(k),
    }),
    inspect,
  );
}

export type FinancesServices = ReturnType<typeof createFinances>;
