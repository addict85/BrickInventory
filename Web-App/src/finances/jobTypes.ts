import { z } from 'zod';
import { auftragsart, type Anmeldung } from '../jobQueue';
import { PricesReload } from './priceItems';
import { preiseNachladen } from './reloadPrices';
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

export function financesJobTypes(k: FinancesContext): Anmeldung[] {
  return [
    auftragsart({ art: 'wechselkurse', nutzlast: LEER, ausfuehren: (_n, l) => rateJob(k, undefined, l) }),
    auftragsart({
      art: 'preise',
      nutzlast: LEER,
      ausfuehren: (_n, l) => runPriceRefresh(k, l),
      exklusiv: true,
      kontouebergreifend: 'Preise aller Sets',
      zeitplan: { minuten: { setting: 'price_job_interval_minutes', vorgabe: 60, mindestens: 5 } },
    }),
    auftragsart({
      art: 'preise_nachladen',
      nutzlast: PricesReload,
      ausfuehren: (n, l) => preiseNachladen(k, n, l),
      exklusiv: true,
    }),
  ];
}
