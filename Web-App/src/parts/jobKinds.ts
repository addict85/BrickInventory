import { z } from 'zod';
import { jobKind, type Login } from '../jobQueue';
import { runCatalogFollowUp } from './summary';
import type { PartsContext } from './context';

const LEER = z.object({});

declare module '../jobQueue/jobs' {
  interface JobPayloads {
    katalog_nachzug: typeof LEER;
  }
}

/** The web process doesn't change the catalog outside system scope; the follow-up for the summary is the job's. */
export function partsJobKinds(k: PartsContext): Login[] {
  return [
    jobKind({
      art: 'katalog_nachzug',
      payload: LEER,
      ausfuehren: async () => void (await runCatalogFollowUp(k)),
      kontouebergreifend: 'Parts summary of all accounts',
    }),
  ];
}
