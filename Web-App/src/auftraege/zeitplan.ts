import type { AuftragsArt, NutzlastEingabe } from './auftraege';
import type { Zeitplan } from './arten';
import { weckeWorker, stelleAuftragEin } from './dienst';
import type { AuftraegeKontext } from './kontext';

/** Je geplanter Art genau ein offener Auftrag `plan:<art>`: Eine geänderte Uhrzeit verschiebt nur faellig_ab. */
export const planSchluessel = (art: AuftragsArt) => `plan:${art}`;

function planVon(k: AuftraegeKontext, art: AuftragsArt): Zeitplan {
  const plan = k.arten.von(art)?.zeitplan;
  if (!plan) throw new Error(`${art} hat keinen Zeitplan`);
  return plan;
}

export const hatZeitplan = (k: AuftraegeKontext, art: AuftragsArt): boolean => !!k.arten.von(art)?.zeitplan;

export function leseUhrzeit(s: string | null | undefined, vorgabe: string): { h: number; min: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim()) ?? /^(\d{1,2}):(\d{2})$/.exec(vorgabe);
  const h = Number(m?.[1] ?? 4),
    min = Number(m?.[2] ?? 0);
  return h > 23 || min > 59 ? leseUhrzeit(vorgabe, '04:00') : { h, min };
}

/** In der Zeitzone des Prozesses. */
export function naechsteUhrzeit(zeit: { h: number; min: number }, jetzt: Date): Date {
  const z = new Date(jetzt);
  z.setHours(zeit.h, zeit.min, 0, 0);
  if (z <= jetzt) z.setDate(z.getDate() + 1);
  return z;
}

export async function taeglicheUhrzeit(
  k: AuftraegeKontext,
  einstellung: string,
  vorgabe: string,
): Promise<{ h: number; min: number }> {
  return leseUhrzeit(await k.einstellungen.globalerWert(einstellung), vorgabe);
}

export async function naechsterLauf(k: AuftraegeKontext, art: AuftragsArt, jetzt = k.uhr.datum()): Promise<Date> {
  const plan = planVon(k, art);
  if ('taeglich' in plan)
    return naechsteUhrzeit(await taeglicheUhrzeit(k, plan.taeglich.einstellung, plan.taeglich.vorgabe), jetzt);
  const roh = plan.minuten.einstellung ? await k.einstellungen.globalerWert(plan.minuten.einstellung) : null;
  const min = Math.max(plan.minuten.mindestens ?? 1, parseInt(String(roh ?? ''), 10) || plan.minuten.vorgabe);
  return new Date(jetzt.getTime() + min * 60_000);
}

/** Ohne Zeitplan nichts: Der Worker ruft es nach jedem Auftrag. */
export async function planeNaechsten<A extends AuftragsArt>(
  k: AuftraegeKontext,
  art: A,
  nutzlast: NutzlastEingabe<A> = {} as NutzlastEingabe<A>,
): Promise<string | null> {
  if (!hatZeitplan(k, art)) return null;
  return stelleAuftragEin(k, art, nutzlast, {
    schluessel: planSchluessel(art),
    faelligAb: await naechsterLauf(k, art),
    maxVersuche: 3,
  });
}

export async function planeAlle(k: AuftraegeKontext): Promise<void> {
  for (const a of k.arten.alle()) if (a.zeitplan) await planeNaechsten(k, a.art);
}

export async function zeitplanGeaendert(k: AuftraegeKontext, art: AuftragsArt): Promise<void> {
  await k.auftraege.setzeFaelligkeit(planSchluessel(art), await naechsterLauf(k, art));
  await weckeWorker(k, art);
}

/** @returns false, wenn er gerade läuft */
export async function ziehePlanVor<A extends AuftragsArt>(
  k: AuftraegeKontext,
  art: A,
  sekunden = 0,
  nutzlast: NutzlastEingabe<A> = {} as NutzlastEingabe<A>,
): Promise<boolean> {
  planVon(k, art);
  if (await k.auftraege.zieheTerminVor(planSchluessel(art), sekunden, k.arten.pruefe(art, nutzlast))) {
    await weckeWorker(k, art);
    return true;
  }
  if (await k.auftraege.laeuftArt(art)) return false;
  await stelleAuftragEin(k, art, nutzlast, { schluessel: planSchluessel(art), nachSekunden: sekunden, maxVersuche: 3 });
  return true;
}
