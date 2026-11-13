/** Sitzungszeilen zu löschen reicht nicht: Eine laufende Anfrage schreibt ihre
 * Sitzung am Ende per Upsert zurück. Deshalb trägt jede Sitzung die Version
 * des Kontos; wer Zugänge beendet, erhöht sie, und jede Anfrage vergleicht. */
import { meldeZugangsAenderung } from './zugangsAenderung';
import type { KontoKontext } from './kontext';

const ZWISCHENSPEICHER_MS = 5_000;
/** Je Zugang: Die Version steht in der Datenbank, aus der sie gelesen wurde. */
const gemerkt = (k: KontoKontext) =>
  k.faecher.fach('sitzungsVersion', () => new Map<number, { version: number | null; bis: number }>());

/** null: Konto fehlt oder ist gesperrt. */
export function sitzungsVersionAusDb(k: KontoKontext, uid: number): Promise<number | null> {
  return k.zugaenge.sitzungsVersion(uid);
}

export async function aktuelleSitzungsVersion(k: KontoKontext, uid: number): Promise<number | null> {
  const g = gemerkt(k).get(uid);
  if (g && g.bis > Date.now()) return g.version;
  const version = await k.zugaenge.sitzungsVersion(uid);
  gemerkt(k).set(uid, { version, bis: Date.now() + ZWISCHENSPEICHER_MS });
  return version;
}

/** Vor dem Löschen der Zeilen aufrufen; liefert die neue Version. */
export async function erhoeheSitzungsVersion(k: KontoKontext, uid: number): Promise<number> {
  const version = await k.zugaenge.zaehleSitzungsVersionHoch(uid);
  gemerkt(k).delete(uid);
  meldeZugangsAenderung();
  return version;
}

/** Nach dem COMMIT einer Transaktion, die die Version erhöht hat: Eine Anfrage
 * dazwischen hätte sonst den alten Stand wieder gemerkt. */
export function vergissSitzungsVersion(k: KontoKontext, uid: number): void {
  gemerkt(k).delete(uid);
  meldeZugangsAenderung();
}
