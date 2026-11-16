/** Sitzungszeilen zu löschen reicht nicht: Eine laufende Anfrage schreibt ihre
 * Sitzung am Ende per Upsert zurück. Deshalb trägt jede Sitzung die Version
 * des Kontos; wer Zugänge beendet, erhöht sie, und jede Anfrage vergleicht. */
import { meldeZugangsAenderung } from './zugangsAenderung';
import { prozessEreignis } from '../infra/ereignis';
import type { KontoKontext } from './kontext';

const ZWISCHENSPEICHER_MS = 5_000;
/** Je Zugang; `stand` zählt jedes Leeren, damit ein älterer Lesestand nicht wieder hineinkommt. */
const speicher = (k: KontoKontext) =>
  k.faecher.fach('sitzungsVersion', () => ({
    eintraege: new Map<number, { version: number | null; bis: number }>(),
    stand: 0,
    verteilt: false,
  }));
const gemerkt = (k: KontoKontext) => speicher(k).eintraege;

/** Ein zweiter Web-Prozess hielte die alte Version sonst bis zu fünf Sekunden: Jede Erhöhung
 * meldet sich über NOTIFY. Ohne stehende Horch-Verbindung gilt nur die Datenbank (fail closed). */
const KANAL = 'sitzung_version';
const erhoeht = (k: KontoKontext) =>
  k.faecher.fach('sitzungsVersionSignal', () => {
    const e = prozessEreignis('sitzungsVersion', KANAL);
    e.horche(() => leere(k));
    return e;
  });
function leere(k: KontoKontext): void {
  const s = speicher(k);
  s.eintraege.clear();
  s.stand++;
}
export function horcheAufSitzungsVersion(k: KontoKontext): void {
  speicher(k).verteilt = true;
  erhoeht(k).verbinde(k.db.benachrichtigung);
}
function nutzbar(k: KontoKontext): boolean {
  if (speicher(k).verteilt && k.db.benachrichtigung.hoertZu(KANAL)) return true;
  leere(k);
  return false;
}
function melde(k: KontoKontext): void {
  if (speicher(k).verteilt) void erhoeht(k).melde(k.db.benachrichtigung);
}

/** null: Konto fehlt oder ist gesperrt. */
export function sitzungsVersionAusDb(k: KontoKontext, uid: number): Promise<number | null> {
  return k.zugaenge.sitzungsVersion(uid);
}

export async function aktuelleSitzungsVersion(k: KontoKontext, uid: number): Promise<number | null> {
  if (!nutzbar(k)) return k.zugaenge.sitzungsVersion(uid);
  const g = gemerkt(k).get(uid);
  if (g && g.bis > k.uhr.jetzt()) return g.version;
  const vorher = speicher(k).stand;
  const version = await k.zugaenge.sitzungsVersion(uid);
  if (speicher(k).stand === vorher) gemerkt(k).set(uid, { version, bis: k.uhr.jetzt() + ZWISCHENSPEICHER_MS });
  return version;
}

/** Vor dem Löschen der Zeilen aufrufen; liefert die neue Version. */
export async function erhoeheSitzungsVersion(k: KontoKontext, uid: number): Promise<number> {
  const version = await k.zugaenge.zaehleSitzungsVersionHoch(uid);
  leere(k);
  meldeZugangsAenderung();
  melde(k);
  return version;
}

/** Nach dem COMMIT einer Transaktion, die die Version erhöht hat: Eine Anfrage
 * dazwischen hätte sonst den alten Stand wieder gemerkt. */
export function vergissSitzungsVersion(k: KontoKontext, _uid: number): void {
  leere(k);
  meldeZugangsAenderung();
  melde(k);
}
