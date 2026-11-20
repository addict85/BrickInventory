/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import type { Db } from '../../db/database';
import { mit, buildArea, type Inspect } from '../infra/area';
import { Faecher } from '../infra/cache';
import * as marketPrice from './marketPrice';
import * as portfolioHistory from './portfolioHistory';
import * as priceHistory from './priceHistory';
import * as valuationService from './calculation/valuation';
import * as gainLossService from './calculation/profitLoss';
import * as preise from './calculation/prices';
import * as priceRunService from './priceRun';
import * as preisRegel from './priceRule';
import { financesJobTypes } from './jobTypes';
import * as exchangeRatesService from './exchangeRates';
import * as preisalarm from './priceAlert';
import { zugang, type FinancesDependencies, type FinancesContext } from './context';

export type { FinancesDependencies, FinancesContext } from './context';

export function createFinances(a: Omit<FinancesDependencies, 'faecher'>, inspect?: Inspect<FinancesContext>) {
  // The price cache applies per currency: a change requires a full price run.
  a.einstellungen.onCurrencyChange(() => a.jobQueue.pullPlanBefore('preise'));
  return buildArea(
    { ...a, faecher: new Faecher() },
    (db: Db) => zugang(db, a.lesevertrag),
    (k: FinancesContext) => ({
      // The price alerts are services; the price run calls them via the context.
      preisalarm: {
        alarmTransfer: mit(k)(preisalarm.alarmTransfer),
        alertsFromCsv: mit(k)(preisalarm.alertsFromCsv),
        alertsFor: mit(k)(preisalarm.alertsFor),
        alleAlarme: mit(k)(preisalarm.alleAlarme),
        triggeredSince: mit(k)(preisalarm.triggeredSince),
        preisalarmeAlsCsv: mit(k)(preisalarm.preisalarmeAlsCsv),
        loescheAlarm: mit(k)(preisalarm.loescheAlarm),
        setzeAlarm: mit(k)(preisalarm.setzeAlarm),
      },
      aktuellerMarktpreis: mit(k)(marketPrice.aktuellerMarktpreis),
      marketPriceFromCache: k.preisCache.marketPriceFromCache,
      marketPriceFromHistory: k.preisCache.marketPriceFromHistory,
      partState: mit(k)(marketPrice.partState),
      marketPricesFromCacheForMinifigs: mit(k)(marketPrice.marketPricesFromCacheForMinifigs),
      marketPricesFromCacheForParts: mit(k)(marketPrice.marketPricesFromCacheForParts),
      figMarketPriceWithOrigin: mit(k)(marketPrice.figMarketPriceWithOrigin),
      marketPriceWithOrigin: mit(k)(marketPrice.marketPriceWithOrigin),
      currentMinifigMarketPrice: mit(k)(marketPrice.currentMinifigMarketPrice),
      currentPartMarketPrice: mit(k)(marketPrice.currentPartMarketPrice),
      portfolioVerlauf: mit(k)(portfolioHistory.portfolioVerlauf),
      priceHistorySet: mit(k)(priceHistory.priceHistorySet),
      priceHistoryPart: mit(k)(priceHistory.priceHistoryPart),
      priceHistoryMinifig: mit(k)(priceHistory.priceHistoryMinifig),
      deleteOldPrices: mit(k)(priceHistory.deleteOldPrices),
      valueSets: mit(k)(valuationService.valueSets),
      valueMinifigs: mit(k)(valuationService.valueMinifigs),
      valueParts: mit(k)(valuationService.valueParts),
      gainAndLoss: mit(k)(gainLossService.gainAndLoss),
      setState: mit(k)(preise.setState),
      emptyPriceCache: mit(k)(preise.emptyPriceCache),
      fetchPrice: mit(k)(preise.fetchPrice),
      farbkarte: mit(k)(preise.farbkarte),
      preisFuerSetHolen: mit(k)(priceRunService.preisFuerSetHolen),
      purchasePriceFromInput: mit(k)(preisRegel.purchasePriceFromInput),
      manuellerKaufpreis: mit(k)(preisRegel.manuellerKaufpreis),
      planeKursabruf: mit(k)(exchangeRatesService.planeKursabruf),
      auftragsarten: () => financesJobTypes(k),
    }),
    inspect,
  );
}

export type FinancesServices = ReturnType<typeof createFinances>;
