import { z } from 'zod';
import { jobKind, type Login } from '../jobQueue';
import { PricesReload } from './priceItems';
import { reloadPrices } from './reloadPrices';
import { runPriceRefresh } from './priceRun';
import { rateJob } from './exchangeRates';
import type { FinancesContext } from './context';

const LEER = z.object({});

declare module '../jobQueue/jobs' {
  interface JobPayloads {
    wechselkurse: typeof LEER;
    preise: typeof LEER;
  }
}

export function financesJobTypes(k: FinancesContext): Login[] {
  return [
    jobKind({ art: 'wechselkurse', payload: LEER, ausfuehren: (_n, l) => rateJob(k, undefined, l) }),
    jobKind({
      art: 'preise',
      payload: LEER,
      ausfuehren: (_n, l) => runPriceRefresh(k, l),
      exklusiv: true,
      kontouebergreifend: 'Preise aller Sets',
      zeitplan: { minuten: { setting: 'price_job_interval_minutes', vorgabe: 60, mindestens: 5 } },
    }),
    jobKind({
      art: 'preise_nachladen',
      payload: PricesReload,
      ausfuehren: (n, l) => reloadPrices(k, n, l),
      exklusiv: true,
    }),
  ];
}
