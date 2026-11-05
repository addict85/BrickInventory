/** Geht die Antwort an den Offline-Ausgang der App verloren, wiederholt er mit
 * demselben Schlüssel und bekommt die gespeicherte Antwort — ohne zweite
 * Wirkung. Derselbe Schlüssel mit anderem Inhalt ist ein Fehler des Clients. */
import * as repo from './repository';
import { HTTP_FRISTEN } from '../infra/httpFristen';
import { verschluessele, entschluessele, istVerschluesselt, kontext, umschluesseln, suchwert } from '../infra/geheimnis';

/** Die App wiederholt innerhalb von Stunden, nicht Tagen. */
export const FRIST_STUNDEN = 24;
/** Danach gilt die erste Anfrage als abgebrochen (Absturz, Neustart): erst nach
 * der längsten erlaubten Anfrage, sonst liefe eine langsame zweimal. */
export const VERWAIST_NACH_S = HTTP_FRISTEN.requestTimeout / 1000 + 60;

/** Konto und Schlüssel im Kontext: Eine gespeicherte Antwort gilt nur für ihren Eintrag. */
export const antwortKontext = (uid: number, schluessel: string) => kontext('idempotenz.antwort', uid, schluessel);

export const SCHLUESSEL_MUSTER = /^[A-Za-z0-9._:-]{1,100}$/;

/** Liegt 24 h in der Tabelle: ohne Passwörter und Codes, der Rest als HMAC, der sich
 * ohne Datenschlüssel nicht durchprobieren lässt. `h1:` trennt ihn vom alten SHA-256. */
const GEHEIM = /pass|secret|geheim|token|_key$|^key$|^current$|code$|^pin$|_pin$/i;
const ABDRUCK = 'h1:';
function ohneGeheimnisse(wert: unknown): unknown {
  if (Array.isArray(wert)) return wert.map(ohneGeheimnisse);
  if (wert === null || typeof wert !== 'object') return wert;
  return Object.fromEntries(Object.entries(wert).map(([k, v]) => [k, GEHEIM.test(k) ? '*' : ohneGeheimnisse(v)]));
}

export function fingerabdruck(methode: string, pfad: string, rumpf: unknown): string {
  return ABDRUCK + suchwert('idempotenz', `${methode} ${pfad}\n${JSON.stringify(ohneGeheimnisse(rumpf ?? null))}`);
}

export function alteAbdrueckeLoeschen(): Promise<number> {
  return repo.loescheAndereAbdruecke(ABDRUCK);
}

export type Ausgang =
  | { art: 'neu' }
  | { art: 'wiederholung'; status: number; antwort: string }
  | { art: 'nicht_wiederholbar' }
  | { art: 'laeuft' }
  | { art: 'anders' };

/** Ohne lesbaren Rumpf lieber eine klare Absage als eine zweite Wirkung. */
export async function beginne(uid: number, schluessel: string, abdruck: string): Promise<Ausgang> {
  if (await repo.belege(uid, schluessel, abdruck, VERWAIST_NACH_S)) return { art: 'neu' };
  const e = await repo.eintrag(uid, schluessel);
  // Zwischen Belegen und Lesen freigegeben (die erste scheiterte): neu versuchen.
  if (!e) return await repo.belege(uid, schluessel, abdruck, VERWAIST_NACH_S) ? { art: 'neu' } : { art: 'laeuft' };
  if (e.anfrage !== abdruck) return { art: 'anders' };
  if (e.status === null) return { art: 'laeuft' };
  const antwort = istVerschluesselt(e.antwort) ? entschluessele(e.antwort, antwortKontext(uid, schluessel)) : null;
  if (antwort === null) return { art: 'nicht_wiederholbar' };
  return { art: 'wiederholung', status: e.status, antwort };
}

/** Ein 5xx wird nicht gemerkt, sondern freigegeben: Die Wirkung ist unsicher,
 * eine Wiederholung soll es noch einmal versuchen dürfen. */
export async function beende(uid: number, schluessel: string, status: number, antwort: string | null): Promise<void> {
  if (status >= 500) await repo.loescheLaufenden(uid, schluessel);
  else await repo.schliesseAb(uid, schluessel, status, antwort === null ? null : verschluessele(antwort, antwortKontext(uid, schluessel)));
}

export function gibFrei(uid: number, schluessel: string): Promise<void> {
  return repo.loescheLaufenden(uid, schluessel);
}

/** v1-Antworten von vor dem Kontext; der Start schlüsselt sie um. */
export async function antwortenUmschluesseln(): Promise<number> {
  let n = 0;
  for (const z of await repo.alteAntworten()) {
    const neu = umschluesseln(z.antwort, antwortKontext(z.user_id, z.schluessel));
    if (neu) n += await repo.ersetzeAntwort(z.user_id, z.schluessel, z.antwort, neu);
  }
  return n;
}

export function raeumeIdempotenzAuf(): Promise<number> {
  return repo.loescheAelterAls(FRIST_STUNDEN);
}
