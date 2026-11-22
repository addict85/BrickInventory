import { z } from 'zod';
import { jobKind, type Login } from '../jobQueue';
import { cleanup, cleanupDaily } from './cleanup';
import { FOLLOW_UP_STEPS, runFollowUp } from './startFollowUpRuns';
import type { ManagementContext } from './context';

const EMPTY = z.object({});
const FollowUpPayload = z.object({ schritt: z.enum(FOLLOW_UP_STEPS) });

declare module '../jobQueue/jobs' {
  interface JobPayloads {
    followup: typeof FollowUpPayload;
    cleanup: typeof EMPTY;
    cleanup_daily: typeof EMPTY;
  }
}

export function managementJobTypes(k: ManagementContext): Login[] {
  return [
    jobKind({
      kind: 'followup',
      payload: FollowUpPayload,
      ausfuehren: (n, l) => runFollowUp(k, n, l),
      kontouebergreifend: 'Altbestand und Katalog aller Konten',
    }),
    jobKind({
      kind: 'cleanup',
      payload: EMPTY,
      ausfuehren: (_n, l) => cleanup(k, l),
      exklusiv: true,
      kontouebergreifend: 'Reste aller Konten',
      zeitplan: { minutes: { preset: 60 } },
    }),
    jobKind({
      kind: 'cleanup_daily',
      payload: EMPTY,
      ausfuehren: (_n, l) => cleanupDaily(k, l),
      exklusiv: true,
      kontouebergreifend: 'Reste aller Konten',
      zeitplan: { minutes: { preset: 24 * 60 } },
    }),
  ];
}
