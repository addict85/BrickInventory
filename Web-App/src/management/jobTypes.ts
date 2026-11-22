import { z } from 'zod';
import { jobKind, type Login } from '../jobQueue';
import { cleanup, cleanupDaily } from './cleanup';
import { FOLLOW_UP_STEPS, runFollowUp } from './startFollowUpRuns';
import type { ManagementContext } from './context';

const EMPTY = z.object({});
const FollowUpPayload = z.object({ schritt: z.enum(FOLLOW_UP_STEPS) });

declare module '../jobQueue/jobs' {
  interface JobPayloads {
    nachlauf: typeof FollowUpPayload;
    aufraeumen: typeof EMPTY;
    aufraeumen_taeglich: typeof EMPTY;
  }
}

export function managementJobTypes(k: ManagementContext): Login[] {
  return [
    jobKind({
      art: 'nachlauf',
      nutzlast: FollowUpPayload,
      ausfuehren: (n, l) => runFollowUp(k, n, l),
      kontouebergreifend: 'Altbestand und Katalog aller Konten',
    }),
    jobKind({
      art: 'aufraeumen',
      nutzlast: EMPTY,
      ausfuehren: (_n, l) => cleanup(k, l),
      exklusiv: true,
      kontouebergreifend: 'Reste aller Konten',
      zeitplan: { minuten: { vorgabe: 60 } },
    }),
    jobKind({
      art: 'aufraeumen_taeglich',
      nutzlast: EMPTY,
      ausfuehren: (_n, l) => cleanupDaily(k, l),
      exklusiv: true,
      kontouebergreifend: 'Reste aller Konten',
      zeitplan: { minuten: { vorgabe: 24 * 60 } },
    }),
  ];
}
