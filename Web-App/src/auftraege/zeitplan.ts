import { getGlobalSetting } from '../einstellungen/settings';
import { notify } from '../../db/pgNotify';
import { type AuftragsArt } from './auftraege';
import { AUFTRAG_KANAL, stelleAuftragEin, setzeFaelligkeit, zieheTerminVor, laeuftArt } from './dienst';

/** Je geplanter Art genau ein offener Auftrag `plan:<art>`; eine geänderte
 * Uhrzeit verschiebt nur faellig_ab — kein Zeitgeber muss neu gestellt werden. */
type Zeitplan =
  | { taeglich: { einstellung: string; vorgabe: string } }
  | { minuten: { einstellung?: string; vorgabe: number; mindestens?: number } };

export const ZEITPLAENE: Partial<Record<AuftragsArt, Zeitplan>> = {
  csv_sync:            { taeglich: { einstellung: 'job_time_csv_sync', vorgabe: '03:00' } },
  preise:              { minuten: { einstellung: 'price_job_interval_minutes', vorgabe: 60, mindestens: 5 } },
  bild_nachlauf:       { minuten: { vorgabe: 60 } },
  aufraeumen:          { minuten: { vorgabe: 60 } },
  aufraeumen_taeglich: { minuten: { vorgabe: 24 * 60 } },
};

/** Brickset hat keinen geplanten Lauf: Jeder wartende Eintrag ist ein Auftrag,
 * fällig zur eingestellten Uhrzeit. */
export const DAILY_JOBS = [
  { name: 'brickset_retry', monitorKey: 'bricksetRetry', default: '04:00' },
  { name: 'csv_sync',       monitorKey: 'csvImport',     default: '03:00' },
] as const;

export const planSchluessel = (art: AuftragsArt) => `plan:${art}`;
export const hatZeitplan = (art: AuftragsArt) => Object.hasOwn(ZEITPLAENE, art);

export function leseUhrzeit(s: string | null | undefined, vorgabe: string): { h: number; min: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim()) ?? /^(\d{1,2}):(\d{2})$/.exec(vorgabe);
  const h = Number(m?.[1] ?? 4), min = Number(m?.[2] ?? 0);
  return h > 23 || min > 59 ? leseUhrzeit(vorgabe, '04:00') : { h, min };
}

/** In der Zeitzone des Prozesses. */
export function naechsteUhrzeit(zeit: { h: number; min: number }, jetzt = new Date()): Date {
  const z = new Date(jetzt);
  z.setHours(zeit.h, zeit.min, 0, 0);
  if (z <= jetzt) z.setDate(z.getDate() + 1);
  return z;
}

export async function taeglicheUhrzeit(name: typeof DAILY_JOBS[number]['name']): Promise<{ h: number; min: number }> {
  const meta = DAILY_JOBS.find(j => j.name === name)!;
  return leseUhrzeit(await getGlobalSetting(`job_time_${name}`), meta.default);
}

export async function naechsterLauf(art: AuftragsArt, jetzt = new Date()): Promise<Date> {
  const plan = ZEITPLAENE[art];
  if (!plan) throw new Error(`kein Zeitplan für ${art}`);
  if ('taeglich' in plan) {
    return naechsteUhrzeit(leseUhrzeit(await getGlobalSetting(plan.taeglich.einstellung), plan.taeglich.vorgabe), jetzt);
  }
  const roh = plan.minuten.einstellung ? await getGlobalSetting(plan.minuten.einstellung) : null;
  const min = Math.max(plan.minuten.mindestens ?? 1, parseInt(String(roh ?? '')) || plan.minuten.vorgabe);
  return new Date(jetzt.getTime() + min * 60_000);
}

export async function planeNaechsten(art: AuftragsArt, nutzlast: Record<string, unknown> = {}): Promise<string | null> {
  return stelleAuftragEin(art, nutzlast, { schluessel: planSchluessel(art), faelligAb: await naechsterLauf(art), maxVersuche: 3 });
}

export async function planeAlle(): Promise<void> {
  for (const art of Object.keys(ZEITPLAENE) as AuftragsArt[]) await planeNaechsten(art);
}

export async function zeitplanGeaendert(art: AuftragsArt): Promise<void> {
  await setzeFaelligkeit(planSchluessel(art), await naechsterLauf(art));
  await notify(AUFTRAG_KANAL, art);
}

/** @returns false, wenn er gerade läuft */
export async function ziehePlanVor(art: AuftragsArt, sekunden = 0, nutzlast: Record<string, unknown> = {}): Promise<boolean> {
  if (await zieheTerminVor(planSchluessel(art), sekunden, nutzlast)) { await notify(AUFTRAG_KANAL, art); return true; }
  if (await laeuftArt(art)) return false;
  await stelleAuftragEin(art, nutzlast, { schluessel: planSchluessel(art), nachSekunden: sekunden, maxVersuche: 3 });
  return true;
}
