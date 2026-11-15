import { z } from 'zod';
import { auftragsart, type Anmeldung } from '../auftraege';
import { aufraeumen, aufraeumenTaeglich } from './aufraeumen';
import { NACHLAUF_SCHRITTE, nachlauf } from './startNachlaeufe';
import type { VerwaltungKontext } from './kontext';

const LEER = z.object({});
const NachlaufNutzlast = z.object({ schritt: z.enum(NACHLAUF_SCHRITTE) });

declare module '../auftraege/auftraege' {
  interface AuftragsNutzlasten {
    nachlauf: typeof NachlaufNutzlast;
    aufraeumen: typeof LEER;
    aufraeumen_taeglich: typeof LEER;
  }
}

export function verwaltungAuftragsarten(k: VerwaltungKontext): Anmeldung[] {
  return [
    auftragsart({
      art: 'nachlauf',
      nutzlast: NachlaufNutzlast,
      ausfuehren: (n, l) => nachlauf(k, n, l),
      kontouebergreifend: 'Altbestand und Katalog aller Konten',
    }),
    auftragsart({
      art: 'aufraeumen',
      nutzlast: LEER,
      ausfuehren: (_n, l) => aufraeumen(k, l),
      exklusiv: true,
      kontouebergreifend: 'Reste aller Konten',
      zeitplan: { minuten: { vorgabe: 60 } },
    }),
    auftragsart({
      art: 'aufraeumen_taeglich',
      nutzlast: LEER,
      ausfuehren: (_n, l) => aufraeumenTaeglich(k, l),
      exklusiv: true,
      kontouebergreifend: 'Reste aller Konten',
      zeitplan: { minuten: { vorgabe: 24 * 60 } },
    }),
  ];
}
