import { z } from 'zod';
import { auftragsart, type Anmeldung } from '../auftraege';
import { runCatalogFollowUp } from './summary';
import type { PartsContext } from './context';

const LEER = z.object({});

declare module '../auftraege/auftraege' {
  interface JobPayloads {
    katalog_nachzug: typeof LEER;
  }
}

/** The web process doesn't change the catalog outside system scope; the follow-up for the summary is the job's. */
export function partsJobKinds(k: PartsContext): Anmeldung[] {
  return [
    auftragsart({
      art: 'katalog_nachzug',
      nutzlast: LEER,
      ausfuehren: async () => void (await runCatalogFollowUp(k)),
      kontouebergreifend: 'Parts summary of all accounts',
    }),
  ];
}
