import type { JobKind, PayloadInput } from './auftraege';
import type { Zeitplan } from './arten';
import { wakeWorker, placeJobOne } from './dienst';
import type { JobsContext } from './kontext';

/** Je geplanter Art genau ein offener Auftrag `plan:<art>`: Eine geänderte Uhrzeit verschiebt nur faellig_ab. */
export const planKey = (art: JobKind) => `plan:${art}`;

function planOf(k: JobsContext, art: JobKind): Zeitplan {
  const plan = k.arten.von(art)?.zeitplan;
  if (!plan) throw new Error(`${art} hat keinen Zeitplan`);
  return plan;
}

export const hatSchedule = (k: JobsContext, art: JobKind): boolean => !!k.arten.von(art)?.zeitplan;

export function readTimeOfDay(s: string | null | undefined, vorgabe: string): { h: number; min: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim()) ?? /^(\d{1,2}):(\d{2})$/.exec(vorgabe);
  const h = Number(m?.[1] ?? 4),
    min = Number(m?.[2] ?? 0);
  return h > 23 || min > 59 ? readTimeOfDay(vorgabe, '04:00') : { h, min };
}

/** In der Zeitzone des Prozesses. */
export function nextTimeOfDay(zeit: { h: number; min: number }, jetzt: Date): Date {
  const z = new Date(jetzt);
  z.setHours(zeit.h, zeit.min, 0, 0);
  if (z <= jetzt) z.setDate(z.getDate() + 1);
  return z;
}

export async function dailyTimeOfDay(
  k: JobsContext,
  setting: string,
  vorgabe: string,
): Promise<{ h: number; min: number }> {
  return readTimeOfDay(await k.einstellungen.globalValue(setting), vorgabe);
}

export async function nextRun(k: JobsContext, art: JobKind, jetzt = k.uhr.datum()): Promise<Date> {
  const plan = planOf(k, art);
  if ('taeglich' in plan)
    return nextTimeOfDay(await dailyTimeOfDay(k, plan.taeglich.setting, plan.taeglich.vorgabe), jetzt);
  const roh = plan.minuten.setting ? await k.einstellungen.globalValue(plan.minuten.setting) : null;
  const min = Math.max(plan.minuten.mindestens ?? 1, parseInt(String(roh ?? ''), 10) || plan.minuten.vorgabe);
  return new Date(jetzt.getTime() + min * 60_000);
}

/** Ohne Zeitplan nichts: Der Worker ruft es nach jedem Auftrag. */
export async function planeNext<A extends JobKind>(
  k: JobsContext,
  art: A,
  nutzlast: PayloadInput<A> = {} as PayloadInput<A>,
): Promise<string | null> {
  if (!hatSchedule(k, art)) return null;
  return placeJobOne(k, art, nutzlast, {
    schluessel: planKey(art),
    dueAb: await nextRun(k, art),
    maxAttempts: 3,
  });
}

export async function planeAll(k: JobsContext): Promise<void> {
  for (const a of k.arten.alle()) if (a.zeitplan) await planeNext(k, a.art);
}

export async function scheduleChanged(k: JobsContext, art: JobKind): Promise<void> {
  await k.auftraege.setDueDate(planKey(art), await nextRun(k, art));
  await wakeWorker(k, art);
}

/** @returns false, wenn er gerade läuft */
export async function pullPlanBefore<A extends JobKind>(
  k: JobsContext,
  art: A,
  seconds = 0,
  nutzlast: PayloadInput<A> = {} as PayloadInput<A>,
): Promise<boolean> {
  planOf(k, art);
  if (await k.auftraege.pullAppointmentBefore(planKey(art), seconds, k.arten.pruefe(art, nutzlast))) {
    await wakeWorker(k, art);
    return true;
  }
  if (await k.auftraege.runningKind(art)) return false;
  await placeJobOne(k, art, nutzlast, { schluessel: planKey(art), afterSeconds: seconds, maxAttempts: 3 });
  return true;
}
