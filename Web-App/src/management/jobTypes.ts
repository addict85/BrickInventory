import { z } from 'zod';
import { auftragsart, type Anmeldung } from '../auftraege';
import { cleanup, cleanupDaily } from './cleanup';
import { NACHLAUF_SCHRITTE, runFollowUp } from './startFollowUpRuns';
import type { ManagementContext } from './context';

const EMPTY = z.object({});
const FollowUpPayload = z.object({ schritt: z.enum(NACHLAUF_SCHRITTE) });

declare module '../auftraege/auftraege' {
  interface AuftragsNutzlasten {
    nachlauf: typeof FollowUpPayload;
    aufraeumen: typeof EMPTY;
    aufraeumen_taeglich: typeof EMPTY;
  }
}

export function managementJobTypes(k: ManagementContext): Anmeldung[] {
  return [
    auftragsart({
      art: 'nachlauf',
      nutzlast: FollowUpPayload,
      ausfuehren: (n, l) => runFollowUp(k, n, l),
      kontouebergreifend: 'Altbestand und Katalog aller Konten',
    }),
    auftragsart({
      art: 'aufraeumen',
      nutzlast: EMPTY,
      ausfuehren: (_n, l) => cleanup(k, l),
      exklusiv: true,
      kontouebergreifend: 'Reste aller Konten',
      zeitplan: { minuten: { vorgabe: 60 } },
    }),
    auftragsart({
      art: 'aufraeumen_taeglich',
      nutzlast: EMPTY,
      ausfuehren: (_n, l) => cleanupDaily(k, l),
      exklusiv: true,
      kontouebergreifend: 'Reste aller Konten',
      zeitplan: { minuten: { vorgabe: 24 * 60 } },
    }),
  ];
}
