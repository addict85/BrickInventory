/** Die Aufträge der Verwaltung: die Nachläufe nach dem Start und das Aufräumen. */
import { z } from 'zod';
import { auftragsart, type Anmeldung } from '../auftraege';
import { NACHLAUF_SCHRITTE } from './startNachlaeufe';
import type { VerwaltungDienste } from './bereich';

const LEER = z.object({});
const NachlaufNutzlast = z.object({ schritt: z.enum(NACHLAUF_SCHRITTE) });

declare module '../auftraege/auftraege' {
  interface AuftragsNutzlasten {
    nachlauf: typeof NachlaufNutzlast;
    aufraeumen: typeof LEER;
    aufraeumen_taeglich: typeof LEER;
  }
}

export function verwaltungAuftragsarten(d: VerwaltungDienste): Anmeldung[] {
  return [
    auftragsart({
      art: 'nachlauf',
      nutzlast: NachlaufNutzlast,
      ausfuehren: (n, k) => d.nachlauf(n, k),
      kontouebergreifend: 'Altbestand und Katalog aller Konten',
    }),
    auftragsart({
      art: 'aufraeumen',
      nutzlast: LEER,
      ausfuehren: (_n, k) => d.aufraeumen(k),
      exklusiv: true,
      kontouebergreifend: 'Reste aller Konten',
      zeitplan: { minuten: { vorgabe: 60 } },
    }),
    auftragsart({
      art: 'aufraeumen_taeglich',
      nutzlast: LEER,
      ausfuehren: (_n, k) => d.aufraeumenTaeglich(k),
      exklusiv: true,
      kontouebergreifend: 'Reste aller Konten',
      zeitplan: { minuten: { vorgabe: 24 * 60 } },
    }),
  ];
}
