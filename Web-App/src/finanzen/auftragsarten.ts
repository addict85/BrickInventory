import { z } from 'zod';
import { auftragsart, type Anmeldung } from '../auftraege';
import { PricesReload } from './preisPosten';
import { preiseNachladen } from './preiseNachladen';
import { runPriceRefresh } from './preisLauf';
import { kursauftrag } from './wechselkurse';
import type { FinancesContext } from './kontext';

const LEER = z.object({});

declare module '../auftraege/auftraege' {
  interface JobPayloads {
    wechselkurse: typeof LEER;
    preise: typeof LEER;
  }
}

export function financesJobTypes(k: FinancesContext): Anmeldung[] {
  return [
    auftragsart({ art: 'wechselkurse', nutzlast: LEER, ausfuehren: (_n, l) => kursauftrag(k, undefined, l) }),
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
