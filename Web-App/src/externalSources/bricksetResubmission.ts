import { z } from 'zod';
import { jobKind, nextTimeOfDay, type Login, type Handler } from '../jobQueue';
import type { ForeignSourcesContext } from './context';

/** One job per set, due at the configured time of day. `versuch` counts across
 * jobs: after 30 days without quota Brickset gives up. */
export const BRICKSET_AT_MOST = 30;
export const BRICKSET_TIME_OF_DAY = { setting: 'job_time_brickset_retry', vorgabe: '04:00' } as const;
export const BricksetPayload = z.object({
  set_number: z.string().min(1).max(64),
  versuch: z.number().int().optional(),
});

declare module '../jobQueue/jobs' {
  interface JobPayloads {
    brickset: typeof BricksetPayload;
  }
}

/** The kind's type and registration live here, where it is queued; the run is provided by the catalog, which knows the sets. */
export function bricksetJobType(ausfuehren: Handler<'brickset'>['ausfuehren']): Login {
  return jobKind({ art: 'brickset', payload: BricksetPayload, ausfuehren, exklusiv: true });
}

const key = (sn: string) => `brickset:${sn}`;

/** Soon (disruption on the remote side) or at the time of day. */
export async function bricksetDueFrom(k: ForeignSourcesContext, bald: boolean): Promise<Date> {
  if (bald) return new Date(k.uhr.jetzt() + 30 * 60_000);
  const time = await k.jobQueue.dailyTimeOfDay(BRICKSET_TIME_OF_DAY.setting, BRICKSET_TIME_OF_DAY.vorgabe);
  return nextTimeOfDay(time, k.uhr.datum());
}

/** @returns vorgemerkt false if it was already queued BRICKSET_AT_MOST times */
export async function bricksetReserve(k: ForeignSourcesContext, sn: string, fehler: string, bald = false) {
  const r = await k.jobQueue.wiedervorlage.rememberBefore(
    'brickset',
    key(sn),
    versuch => ({ set_number: sn, versuch }),
    {
      dueAb: await bricksetDueFrom(k, bald),
      fehler,
      hoechstens: BRICKSET_AT_MOST,
    },
  );
  return { ...r, hoechstens: BRICKSET_AT_MOST };
}

export function bricksetForgotten(k: ForeignSourcesContext, sn: string): Promise<void> {
  return k.jobQueue.wiedervorlage.forget(key(sn));
}

/** Without a number, all; the kind's pause (quota exhausted) ends as well. */
export async function bricksetNow(k: ForeignSourcesContext, sn?: string): Promise<void> {
  await k.jobQueue.endPause('brickset');
  await k.jobQueue.wiedervorlage.now('brickset', sn ? key(sn) : undefined);
}

export function bricksetPrefer(k: ForeignSourcesContext, bis: Date): Promise<void> {
  return k.jobQueue.wiedervorlage.prefer('brickset', bis);
}

export function bricksetNumbers(k: ForeignSourcesContext) {
  return k.jobQueue.wiedervorlage.numbers('brickset');
}

export async function bricksetWaiting(k: ForeignSourcesContext) {
  return (await k.jobQueue.wiedervorlage.waiting('brickset')).map(z => {
    const n = BricksetPayload.safeParse(z.payload);
    return {
      set_number: n.success ? n.data.set_number : '',
      versuch: (n.success ? n.data.versuch : undefined) ?? 1,
      faellig_ab: z.due_at,
      fehler: z.error_message,
      erstellt: z.created_at,
    };
  });
}
