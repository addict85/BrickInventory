/**
 * Idempotente schreibende Anfragen. Der Offline-Ausgang der App schickt jede
 * Anfrage mit einem eigenen Schlüssel; geht die Antwort verloren, wiederholt
 * er sie mit demselben. Die Wiederholung bekommt die gespeicherte Antwort und
 * wirkt kein zweites Mal. Ein Schlüssel gehört zu genau einer Anfrage (Methode,
 * Pfad, Rumpf): Derselbe Schlüssel mit anderem Inhalt ist ein Fehler des
 * Clients, kein Wiederholen.
 */
import crypto from 'crypto';
import * as repo from './repository';

/** So lange gilt ein Schlüssel; die App wiederholt innerhalb von Stunden, nicht Tagen. */
export const FRIST_STUNDEN = 24;
/** Eine erste Anfrage, die so lange nicht fertig wird, ist abgebrochen (Absturz, Neustart). */
const VERWAIST_NACH_S = 120;

export const SCHLUESSEL_MUSTER = /^[A-Za-z0-9._:-]{1,100}$/;

/** Fingerabdruck einer Anfrage: Methode, Pfad samt Abfrage und Rumpf. */
export function fingerabdruck(methode: string, pfad: string, rumpf: unknown): string {
  return crypto.createHash('sha256').update(`${methode} ${pfad}\n${JSON.stringify(rumpf ?? null)}`).digest('hex');
}

export type Ausgang =
  | { art: 'neu' }
  | { art: 'wiederholung'; status: number; antwort: string }
  | { art: 'laeuft' }
  | { art: 'anders' };

/** Was mit einer Anfrage unter diesem Schlüssel geschieht. */
export async function beginne(uid: number, schluessel: string, abdruck: string): Promise<Ausgang> {
  if (await repo.belege(uid, schluessel, abdruck, VERWAIST_NACH_S)) return { art: 'neu' };
  const e = await repo.eintrag(uid, schluessel);
  // Zwischen Belegen und Lesen freigegeben (die erste scheiterte): neu versuchen.
  if (!e) return await repo.belege(uid, schluessel, abdruck, VERWAIST_NACH_S) ? { art: 'neu' } : { art: 'laeuft' };
  if (e.anfrage !== abdruck) return { art: 'anders' };
  if (e.status === null || e.antwort === null) return { art: 'laeuft' };
  return { art: 'wiederholung', status: e.status, antwort: e.antwort };
}

/**
 * Die Antwort der ersten Anfrage merken. Ein Serverfehler (5xx) wird nicht
 * gemerkt, sondern freigegeben: Die Wirkung ist dann unsicher, und eine
 * Wiederholung soll es noch einmal versuchen dürfen.
 */
export async function beende(uid: number, schluessel: string, status: number, antwort: string): Promise<void> {
  if (status >= 500) await repo.loescheLaufenden(uid, schluessel);
  else await repo.schliesseAb(uid, schluessel, status, antwort);
}

export function gibFrei(uid: number, schluessel: string): Promise<void> {
  return repo.loescheLaufenden(uid, schluessel);
}

/** Stündlich im Auftrag 'aufraeumen'. */
export function raeumeIdempotenzAuf(): Promise<number> {
  return repo.loescheAelterAls(FRIST_STUNDEN);
}
