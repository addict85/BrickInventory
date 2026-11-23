import type { JobKind, PayloadInput } from './jobs';
import type { Schedule } from './kinds';
import { wakeWorker, placeJobOne } from './service';
import type { JobsContext } from './context';

/** Per scheduled kind exactly one open job `plan:<art>`: a changed time only moves faellig_ab. */
export const planKey = (kind: JobKind) => `plan:${kind}`;

function planOf(k: JobsContext, kind: JobKind): Schedule {
  const plan = k.kinds.fromValue(kind)?.schedule;
  if (!plan) throw new Error(`${kind} hat keinen Zeitplan`);
  return plan;
}

export const hasSchedule = (k: JobsContext, kind: JobKind): boolean => !!k.kinds.fromValue(kind)?.schedule;

export function readTimeOfDay(s: string | null | undefined, defaultValue: string): { h: number; min: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim()) ?? /^(\d{1,2}):(\d{2})$/.exec(defaultValue);
  const h = Number(m?.[1] ?? 4),
    min = Number(m?.[2] ?? 0);
  return h > 23 || min > 59 ? readTimeOfDay(defaultValue, '04:00') : { h, min };
}

/** In the process's time zone. */
export function nextTimeOfDay(time: { h: number; min: number }, now: Date): Date {
  const z = new Date(now);
  z.setHours(time.h, time.min, 0, 0);
  if (z <= now) z.setDate(z.getDate() + 1);
  return z;
}

export async function dailyTimeOfDay(
  k: JobsContext,
  setting: string,
  defaultValue: string,
): Promise<{ h: number; min: number }> {
  return readTimeOfDay(await k.settings.globalValue(setting), defaultValue);
}

export async function nextRun(k: JobsContext, kind: JobKind, now = k.clock.date()): Promise<Date> {
  const plan = planOf(k, kind);
  if ('daily' in plan) return nextTimeOfDay(await dailyTimeOfDay(k, plan.daily.setting, plan.daily.preset), now);
  const raw = plan.minutes.setting ? await k.settings.globalValue(plan.minutes.setting) : null;
  const min = Math.max(plan.minutes.atLeast ?? 1, parseInt(String(raw ?? ''), 10) || plan.minutes.preset);
  return new Date(now.getTime() + min * 60_000);
}

/** Without a schedule nothing: the worker calls it after every job. */
export async function planNext<A extends JobKind>(
  k: JobsContext,
  kind: A,
  payload: PayloadInput<A> = {} as PayloadInput<A>,
): Promise<string | null> {
  if (!hasSchedule(k, kind)) return null;
  return placeJobOne(k, kind, payload, {
    key: planKey(kind),
    dueFrom: await nextRun(k, kind),
    maxAttempts: 3,
  });
}

export async function planAll(k: JobsContext): Promise<void> {
  for (const a of k.kinds.all()) if (a.schedule) await planNext(k, a.kind);
}

export async function scheduleChanged(k: JobsContext, kind: JobKind): Promise<void> {
  await k.jobs.setDueDate(planKey(kind), await nextRun(k, kind));
  await wakeWorker(k, kind);
}

/** @returns false if it is running right now */
export async function pullPlanBefore<A extends JobKind>(
  k: JobsContext,
  kind: A,
  seconds = 0,
  payload: PayloadInput<A> = {} as PayloadInput<A>,
): Promise<boolean> {
  planOf(k, kind);
  if (await k.jobs.pullAppointmentBefore(planKey(kind), seconds, k.kinds.check(kind, payload))) {
    await wakeWorker(k, kind);
    return true;
  }
  if (await k.jobs.runningKind(kind)) return false;
  await placeJobOne(k, kind, payload, { key: planKey(kind), afterSeconds: seconds, maxAttempts: 3 });
  return true;
}
