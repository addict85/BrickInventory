import type { AuftragsArt } from './auftraege';
import { AUFTRAG_KANAL, stelleAuftragEin } from './dienst';
import { pruefeNutzlast, type NutzlastEingabe } from './nutzlasten';
import type { AuftraegeKontext } from './kontext';

/** Je geplanter Art genau ein offener Auftrag `plan:<art>`; eine geänderte
 * Uhrzeit verschiebt nur faellig_ab — kein Zeitgeber muss neu gestellt werden. */
type Zeitplan =
  | { taeglich: { einstellung: string; vorgabe: string } }
  | { minuten: { einstellung?: string; vorgabe: number; mindestens?: number } };

export type GeplanteArt = 'csv_sync' | 'preise' | 'bild_nachlauf' | 'aufraeumen' | 'aufraeumen_taeglich';
type PlanNutzlast = NutzlastEingabe<GeplanteArt>;

export const ZEITPLAENE: Record<GeplanteArt, Zeitplan> = {
  csv_sync: { taeglich: { einstellung: 'job_time_csv_sync', vorgabe: '03:00' } },
  preise: { minuten: { einstellung: 'price_job_interval_minutes', vorgabe: 60, mindestens: 5 } },
  bild_nachlauf: { minuten: { vorgabe: 60 } },
  aufraeumen: { minuten: { vorgabe: 60 } },
  aufraeumen_taeglich: { minuten: { vorgabe: 24 * 60 } },
};

/** Brickset hat keinen geplanten Lauf: Jeder wartende Eintrag ist ein Auftrag,
 * fällig zur eingestellten Uhrzeit. */
export const DAILY_JOBS = [
  { name: 'brickset_retry', monitorKey: 'bricksetRetry', default: '04:00' },
  { name: 'csv_sync', monitorKey: 'csvImport', default: '03:00' },
] as const;

export const planSchluessel = (art: AuftragsArt) => `plan:${art}`;
export const hatZeitplan = (art: AuftragsArt): art is GeplanteArt => Object.hasOwn(ZEITPLAENE, art);

export function leseUhrzeit(s: string | null | undefined, vorgabe: string): { h: number; min: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim()) ?? /^(\d{1,2}):(\d{2})$/.exec(vorgabe);
  const h = Number(m?.[1] ?? 4),
    min = Number(m?.[2] ?? 0);
  return h > 23 || min > 59 ? leseUhrzeit(vorgabe, '04:00') : { h, min };
}

/** In der Zeitzone des Prozesses. */
export function naechsteUhrzeit(zeit: { h: number; min: number }, jetzt = new Date()): Date {
  const z = new Date(jetzt);
  z.setHours(zeit.h, zeit.min, 0, 0);
  if (z <= jetzt) z.setDate(z.getDate() + 1);
  return z;
}

export async function taeglicheUhrzeit(
  k: AuftraegeKontext,
  name: (typeof DAILY_JOBS)[number]['name'],
): Promise<{ h: number; min: number }> {
  const meta = DAILY_JOBS.find(j => j.name === name)!;
  return leseUhrzeit(await k.einstellungen.getGlobalSetting(`job_time_${name}`), meta.default);
}

export async function naechsterLauf(k: AuftraegeKontext, art: GeplanteArt, jetzt = new Date()): Promise<Date> {
  const plan = ZEITPLAENE[art];
  if ('taeglich' in plan) {
    return naechsteUhrzeit(
      leseUhrzeit(await k.einstellungen.getGlobalSetting(plan.taeglich.einstellung), plan.taeglich.vorgabe),
      jetzt,
    );
  }
  const roh = plan.minuten.einstellung ? await k.einstellungen.getGlobalSetting(plan.minuten.einstellung) : null;
  const min = Math.max(plan.minuten.mindestens ?? 1, parseInt(String(roh ?? ''), 10) || plan.minuten.vorgabe);
  return new Date(jetzt.getTime() + min * 60_000);
}

export async function planeNaechsten(
  k: AuftraegeKontext,
  art: GeplanteArt,
  nutzlast: PlanNutzlast = {},
): Promise<string | null> {
  return stelleAuftragEin(k, art, nutzlast, {
    schluessel: planSchluessel(art),
    faelligAb: await naechsterLauf(k, art),
    maxVersuche: 3,
  });
}

export async function planeAlle(k: AuftraegeKontext): Promise<void> {
  for (const art of Object.keys(ZEITPLAENE) as GeplanteArt[]) await planeNaechsten(k, art);
}

export async function zeitplanGeaendert(k: AuftraegeKontext, art: GeplanteArt): Promise<void> {
  await k.auftraege.setzeFaelligkeit(planSchluessel(art), await naechsterLauf(k, art));
  await k.db.benachrichtigung.notify(AUFTRAG_KANAL, art);
}

/** @returns false, wenn er gerade läuft */
export async function ziehePlanVor(
  k: AuftraegeKontext,
  art: GeplanteArt,
  sekunden = 0,
  nutzlast: PlanNutzlast = {},
): Promise<boolean> {
  if (await k.auftraege.zieheTerminVor(planSchluessel(art), sekunden, pruefeNutzlast(art, nutzlast))) {
    await k.db.benachrichtigung.notify(AUFTRAG_KANAL, art);
    return true;
  }
  if (await k.auftraege.laeuftArt(art)) return false;
  await stelleAuftragEin(k, art, nutzlast, { schluessel: planSchluessel(art), nachSekunden: sekunden, maxVersuche: 3 });
  return true;
}
