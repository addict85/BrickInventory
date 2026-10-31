import * as db from '../db/database';
import { getGlobalSetting } from './settings';
import { notify } from '../db/pgNotify';
import { AUFTRAG_KANAL, stelleAuftragEin, type AuftragsArt } from './auftraege';

/**
 * Zeitpläne als geplante Aufträge: Je geplanter Art steht genau ein offener
 * Auftrag mit dem Schlüssel `plan:<art>` und dem nächsten Termin in
 * faellig_ab. Ist er durch, trägt der Worker den nächsten ein. Eine geänderte
 * Uhrzeit verschiebt nur faellig_ab — kein Zeitgeber muss neu gestellt werden.
 */
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

/**
 * Die täglichen Uhrzeiten der Verwaltung (monitorKey ist der Name der Kachel).
 * Brickset hat keinen geplanten Lauf: Jeder wartende Eintrag ist ein Auftrag,
 * fällig zur eingestellten Uhrzeit.
 */
export const DAILY_JOBS = [
  { name: 'brickset_retry', monitorKey: 'bricksetRetry', default: '04:00' },
  { name: 'csv_sync',       monitorKey: 'csvImport',     default: '03:00' },
] as const;

export const planSchluessel = (art: AuftragsArt) => `plan:${art}`;
export const hatZeitplan = (art: AuftragsArt) => Object.hasOwn(ZEITPLAENE, art);

/** "HH:MM" → {h, min}, sonst die Vorgabe. */
export function leseUhrzeit(s: string | null | undefined, vorgabe: string): { h: number; min: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim()) ?? /^(\d{1,2}):(\d{2})$/.exec(vorgabe);
  const h = Number(m?.[1] ?? 4), min = Number(m?.[2] ?? 0);
  return h > 23 || min > 59 ? leseUhrzeit(vorgabe, '04:00') : { h, min };
}

/** Der nächste Zeitpunkt nach `jetzt` mit dieser Uhrzeit, in der Zeitzone des Prozesses. */
export function naechsteUhrzeit(zeit: { h: number; min: number }, jetzt = new Date()): Date {
  const z = new Date(jetzt);
  z.setHours(zeit.h, zeit.min, 0, 0);
  if (z <= jetzt) z.setDate(z.getDate() + 1);
  return z;
}

/** Die eingestellte Uhrzeit eines täglichen Laufs (Name aus DAILY_JOBS). */
export async function taeglicheUhrzeit(name: typeof DAILY_JOBS[number]['name']): Promise<{ h: number; min: number }> {
  const meta = DAILY_JOBS.find(j => j.name === name)!;
  return leseUhrzeit(await getGlobalSetting(`job_time_${name}`), meta.default);
}

/** Wann der nächste geplante Lauf dieser Art fällig ist. */
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

/** Den nächsten Lauf eintragen, falls keiner offen steht. */
export async function planeNaechsten(art: AuftragsArt, nutzlast: Record<string, unknown> = {}): Promise<string | null> {
  return stelleAuftragEin(art, nutzlast, { schluessel: planSchluessel(art), faelligAb: await naechsterLauf(art), maxVersuche: 3 });
}

/** Beim Start des Job-Prozesses: Jede geplante Art bekommt ihren Termin, falls er fehlt. */
export async function planeAlle(): Promise<void> {
  for (const art of Object.keys(ZEITPLAENE) as AuftragsArt[]) await planeNaechsten(art);
}

/** Nach einer geänderten Uhrzeit oder einem neuen Intervall: den offenen Termin neu setzen. */
export async function zeitplanGeaendert(art: AuftragsArt): Promise<void> {
  await db.run(`UPDATE auftraege SET faellig_ab = $2, aktualisiert = NOW() WHERE schluessel = $1 AND status = 'offen'`,
    [planSchluessel(art), await naechsterLauf(art)]);
  await notify(AUFTRAG_KANAL, art);
}

/**
 * Den geplanten Lauf vorziehen, höchstens bis in `sekunden`; die Nutzlast wird
 * ergänzt (etwa `beimStart`). @returns false, wenn er gerade läuft
 */
export async function ziehePlanVor(art: AuftragsArt, sekunden = 0, nutzlast: Record<string, unknown> = {}): Promise<boolean> {
  const r = await db.run(
    `UPDATE auftraege SET faellig_ab = LEAST(faellig_ab, NOW() + make_interval(secs => $2)),
            nutzlast = nutzlast || $3::jsonb, aktualisiert = NOW()
      WHERE schluessel = $1 AND status = 'offen'`, [planSchluessel(art), sekunden, JSON.stringify(nutzlast)]);
  if ((r?.changes ?? 0) > 0) { await notify(AUFTRAG_KANAL, art); return true; }
  const laeuft = await db.get(`SELECT 1 FROM auftraege WHERE art = $1 AND status = 'laeuft'`, [art]);
  if (laeuft) return false;
  await stelleAuftragEin(art, nutzlast, { schluessel: planSchluessel(art), nachSekunden: sekunden, maxVersuche: 3 });
  return true;
}
