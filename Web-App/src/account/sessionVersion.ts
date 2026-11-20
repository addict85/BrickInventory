/** Sitzungszeilen zu löschen reicht nicht: Eine laufende Anfrage schreibt ihre
 * Sitzung am Ende per Upsert zurück. Deshalb trägt jede Sitzung die Version
 * des Kontos; wer Zugänge beendet, erhöht sie, und jede Anfrage vergleicht. */
import { reportAccessChange } from './accessChange';
import { processEvent } from '../infra/ereignis';
import type { AccountContext } from './context';

const CACHE_MS = 5_000;
/** Je Zugang; `stand` zählt jedes Leeren, damit ein älterer Lesestand nicht wieder hineinkommt. */
const speicher = (k: AccountContext) =>
  k.faecher.fach('sitzungsVersion', () => ({
    eintraege: new Map<number, { version: number | null; bis: number }>(),
    stand: 0,
    verteilt: false,
  }));
const gemerkt = (k: AccountContext) => speicher(k).eintraege;

/** Ein zweiter Web-Prozess hielte die alte Version sonst bis zu fünf Sekunden: Jede Erhöhung
 * meldet sich über NOTIFY. Ohne stehende Horch-Verbindung gilt nur die Datenbank (fail closed). */
const CHANNEL = 'sitzung_version';
const increased = (k: AccountContext) =>
  k.faecher.fach('sitzungsVersionSignal', () => {
    const e = processEvent('sitzungsVersion', CHANNEL);
    e.horche(() => forgetAllSessionVersions(k));
    return e;
  });
function forgetAllSessionVersions(k: AccountContext): void {
  const s = speicher(k);
  s.eintraege.clear();
  s.stand++;
}
export function listenOnSessionVersion(k: AccountContext): void {
  speicher(k).verteilt = true;
  increased(k).connect(k.db.notification);
}
function nutzbar(k: AccountContext): boolean {
  if (speicher(k).verteilt && k.db.notification.listensTo(CHANNEL)) return true;
  forgetAllSessionVersions(k);
  return false;
}
function reportIncrease(k: AccountContext): void {
  if (speicher(k).verteilt) void increased(k).melde(k.db.notification);
}

/** null: Konto fehlt oder ist gesperrt. */
export function sessionVersionFromDb(k: AccountContext, uid: number): Promise<number | null> {
  return k.zugaenge.sitzungsVersion(uid);
}

export async function currentSessionVersion(k: AccountContext, uid: number): Promise<number | null> {
  if (!nutzbar(k)) return k.zugaenge.sitzungsVersion(uid);
  const g = gemerkt(k).get(uid);
  if (g && g.bis > k.uhr.jetzt()) return g.version;
  const vorher = speicher(k).stand;
  const version = await k.zugaenge.sitzungsVersion(uid);
  if (speicher(k).stand === vorher) gemerkt(k).set(uid, { version, bis: k.uhr.jetzt() + CACHE_MS });
  return version;
}

/** Vor dem Löschen der Zeilen aufrufen; liefert die neue Version. */
export async function increaseSessionVersion(k: AccountContext, uid: number): Promise<number> {
  const version = await k.zugaenge.countSessionVersionHigh(uid);
  forgetAllSessionVersions(k);
  reportAccessChange();
  reportIncrease(k);
  return version;
}

/** Nach dem COMMIT einer Transaktion, die die Version erhöht hat: Eine Anfrage
 * dazwischen hätte sonst den alten Stand wieder gemerkt. */
export function forgetSessionVersion(k: AccountContext, _uid: number): void {
  forgetAllSessionVersions(k);
  reportAccessChange();
  reportIncrease(k);
}
