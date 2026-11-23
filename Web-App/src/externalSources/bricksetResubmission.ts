import { z } from 'zod';
import { jobKind, nextTimeOfDay, type Login, type Handler } from '../jobQueue';
import type { ForeignSourcesContext } from './context';

/** One job per set, due at the configured time of day. `versuch` counts across
 * jobs: after 30 days without quota Brickset gives up. */
export const BRICKSET_AT_MOST = 30;
export const BRICKSET_TIME_OF_DAY = { setting: 'job_time_brickset_retry', preset: '04:00' } as const;
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
export function bricksetJobType(run: Handler<'brickset'>['run']): Login {
  return jobKind({ kind: 'brickset', payload: BricksetPayload, run, exclusive: true });
}

const key = (sn: string) => `brickset:${sn}`;

/** Soon (disruption on the remote side) or at the time of day. */
export async function bricksetDueFrom(k: ForeignSourcesContext, soon: boolean): Promise<Date> {
  if (soon) return new Date(k.clock.now() + 30 * 60_000);
  const time = await k.jobQueue.dailyTimeOfDay(BRICKSET_TIME_OF_DAY.setting, BRICKSET_TIME_OF_DAY.preset);
  return nextTimeOfDay(time, k.clock.date());
}

/** @returns vorgemerkt false if it was already queued BRICKSET_AT_MOST times */
export async function bricksetReserve(k: ForeignSourcesContext, sn: string, error: string, soon = false) {
  const r = await k.jobQueue.resubmission.rememberBefore(
    'brickset',
    key(sn),
    attempt => ({ set_number: sn, versuch: attempt }),
    {
      dueFrom: await bricksetDueFrom(k, soon),
      error,
      atMost: BRICKSET_AT_MOST,
    },
  );
  return { ...r, atMost: BRICKSET_AT_MOST };
}

export function bricksetForgotten(k: ForeignSourcesContext, sn: string): Promise<void> {
  return k.jobQueue.resubmission.forget(key(sn));
}

/** Without a number, all; the kind's pause (quota exhausted) ends as well. */
export async function bricksetNow(k: ForeignSourcesContext, sn?: string): Promise<void> {
  await k.jobQueue.endPause('brickset');
  await k.jobQueue.resubmission.now('brickset', sn ? key(sn) : undefined);
}

export function bricksetPrefer(k: ForeignSourcesContext, bis: Date): Promise<void> {
  return k.jobQueue.resubmission.prefer('brickset', bis);
}

export function bricksetNumbers(k: ForeignSourcesContext) {
  return k.jobQueue.resubmission.numbers('brickset');
}

export async function bricksetWaiting(k: ForeignSourcesContext) {
  return (await k.jobQueue.resubmission.waiting('brickset')).map(z => {
    const n = BricksetPayload.safeParse(z.payload);
    return {
      set_number: n.success ? n.data.set_number : '',
      attempt: (n.success ? n.data.versuch : undefined) ?? 1,
      due_at: z.due_at,
      error: z.error_message,
      created: z.created_at,
    };
  });
}
