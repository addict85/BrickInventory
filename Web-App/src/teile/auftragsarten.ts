import { z } from 'zod';
import { auftragsart, type Anmeldung } from '../auftraege';
import { zieheKatalogNach } from './partsSummary';
import type { TeileKontext } from './kontext';

const LEER = z.object({});

declare module '../auftraege/auftraege' {
  interface AuftragsNutzlasten {
    katalog_nachzug: typeof LEER;
  }
}

/** Der Web-Prozess ändert den Katalog nicht im Systemrahmen; den Nachzug der Zusammenfassung macht der Job. */
export function teileAuftragsarten(k: TeileKontext): Anmeldung[] {
  return [
    auftragsart({
      art: 'katalog_nachzug',
      nutzlast: LEER,
      ausfuehren: async () => void (await zieheKatalogNach(k)),
      kontouebergreifend: 'Teilezusammenfassung aller Konten',
    }),
  ];
}
