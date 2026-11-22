import type { JobKind, PayloadInput } from './jobs';
import type { Schedule } from './kinds';
import { wakeWorker, placeJobOne } from './service';
import type { JobsContext } from './context';

/** Per scheduled kind exactly one open job `plan:<art>`: a changed time only moves faellig_ab. */
export const planKey = (art: JobKind) => `plan:${art}`;

function planOf(k: JobsContext, art: JobKind): Schedule {
  const plan = k.arten.fromValue(art)?.zeitplan;
  if (!plan) throw new Error(`${art} hat keinen Zeitplan`);
  return plan;
}

export const hatSchedule = (k: JobsContext, art: JobKind): boolean => !!k.arten.fromValue(art)?.zeitplan;

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
  return readTimeOfDay(await k.einstellungen.globalValue(setting), defaultValue);
}

export async function nextRun(k: JobsContext, art: JobKind, now = k.uhr.datum()): Promise<Date> {
  const plan = planOf(k, art);
  if ('taeglich' in plan)
    return nextTimeOfDay(await dailyTimeOfDay(k, plan.taeglich.setting, plan.taeglich.vorgabe), now);
  const raw = plan.minuten.setting ? await k.einstellungen.globalValue(plan.minuten.setting) : null;
  const min = Math.max(plan.minuten.mindestens ?? 1, parseInt(String(raw ?? ''), 10) || plan.minuten.vorgabe);
  return new Date(now.getTime() + min * 60_000);
}

/** Without a schedule nothing: the worker calls it after every job. */
export async function planeNext<A extends JobKind>(
  k: JobsContext,
  art: A,
  payload: PayloadInput<A> = {} as PayloadInput<A>,
): Promise<string | null> {
  if (!hatSchedule(k, art)) return null;
  return placeJobOne(k, art, payload, {
    schluessel: planKey(art),
    dueAb: await nextRun(k, art),
    maxAttempts: 3,
  });
}

export async function planeAll(k: JobsContext): Promise<void> {
  for (const a of k.arten.all()) if (a.zeitplan) await planeNext(k, a.art);
}

export async function scheduleChanged(k: JobsContext, art: JobKind): Promise<void> {
  await k.auftraege.setDueDate(planKey(art), await nextRun(k, art));
  await wakeWorker(k, art);
}

/** @returns false if it is running right now */
export async function pullPlanBefore<A extends JobKind>(
  k: JobsContext,
  art: A,
  seconds = 0,
  payload: PayloadInput<A> = {} as PayloadInput<A>,
): Promise<boolean> {
  planOf(k, art);
  if (await k.auftraege.pullAppointmentBefore(planKey(art), seconds, k.arten.check(art, payload))) {
    await wakeWorker(k, art);
    return true;
  }
  if (await k.auftraege.runningKind(art)) return false;
  await placeJobOne(k, art, payload, { schluessel: planKey(art), afterSeconds: seconds, maxAttempts: 3 });
  return true;
}
