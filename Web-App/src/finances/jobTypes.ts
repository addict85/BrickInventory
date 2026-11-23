import { z } from 'zod';
import { jobKind, type Login } from '../jobQueue';
import { PricesReload } from './priceItems';
import { reloadPrices } from './reloadPrices';
import { runPriceRefresh } from './priceRun';
import { rateJob } from './exchangeRates';
import type { FinancesContext } from './context';

const EMPTY = z.object({});

declare module '../jobQueue/jobs' {
  interface JobPayloads {
    exchange_rates: typeof EMPTY;
    prices: typeof EMPTY;
  }
}

export function financesJobTypes(k: FinancesContext): Login[] {
  return [
    jobKind({ kind: 'exchange_rates', payload: EMPTY, run: (_n, l) => rateJob(k, undefined, l) }),
    jobKind({
      kind: 'prices',
      payload: EMPTY,
      run: (_n, l) => runPriceRefresh(k, l),
      exclusive: true,
      crossAccount: 'Preise aller Sets',
      schedule: { minutes: { setting: 'price_job_interval_minutes', preset: 60, atLeast: 5 } },
    }),
    jobKind({
      kind: 'price_refresh',
      payload: PricesReload,
      run: (n, l) => reloadPrices(k, n, l),
      exclusive: true,
    }),
  ];
}
