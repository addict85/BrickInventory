/** Geht die Antwort an den Offline-Ausgang der App verloren, wiederholt er mit
 * demselben Schlüssel und bekommt die gespeicherte Antwort — ohne zweite
 * Wirkung. Derselbe Schlüssel mit anderem Inhalt ist ein Fehler des Clients. */
import crypto from 'crypto';
import * as repo from './repository';

/** Die App wiederholt innerhalb von Stunden, nicht Tagen. */
export const FRIST_STUNDEN = 24;
/** Danach gilt die erste Anfrage als abgebrochen (Absturz, Neustart). */
const VERWAIST_NACH_S = 120;

export const SCHLUESSEL_MUSTER = /^[A-Za-z0-9._:-]{1,100}$/;

export function fingerabdruck(methode: string, pfad: string, rumpf: unknown): string {
  return crypto.createHash('sha256').update(`${methode} ${pfad}\n${JSON.stringify(rumpf ?? null)}`).digest('hex');
}

export type Ausgang =
  | { art: 'neu' }
  | { art: 'wiederholung'; status: number; antwort: string }
  | { art: 'laeuft' }
  | { art: 'anders' };

export async function beginne(uid: number, schluessel: string, abdruck: string): Promise<Ausgang> {
  if (await repo.belege(uid, schluessel, abdruck, VERWAIST_NACH_S)) return { art: 'neu' };
  const e = await repo.eintrag(uid, schluessel);
  // Zwischen Belegen und Lesen freigegeben (die erste scheiterte): neu versuchen.
  if (!e) return await repo.belege(uid, schluessel, abdruck, VERWAIST_NACH_S) ? { art: 'neu' } : { art: 'laeuft' };
  if (e.anfrage !== abdruck) return { art: 'anders' };
  if (e.status === null || e.antwort === null) return { art: 'laeuft' };
  return { art: 'wiederholung', status: e.status, antwort: e.antwort };
}

/** Ein 5xx wird nicht gemerkt, sondern freigegeben: Die Wirkung ist unsicher,
 * eine Wiederholung soll es noch einmal versuchen dürfen. */
export async function beende(uid: number, schluessel: string, status: number, antwort: string): Promise<void> {
  if (status >= 500) await repo.loescheLaufenden(uid, schluessel);
  else await repo.schliesseAb(uid, schluessel, status, antwort);
}

export function gibFrei(uid: number, schluessel: string): Promise<void> {
  return repo.loescheLaufenden(uid, schluessel);
}

export function raeumeIdempotenzAuf(): Promise<number> {
  return repo.loescheAelterAls(FRIST_STUNDEN);
}
