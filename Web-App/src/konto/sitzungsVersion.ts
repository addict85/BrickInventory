/** Sitzungszeilen zu löschen reicht nicht: Eine laufende Anfrage schreibt ihre
 * Sitzung am Ende per Upsert zurück. Deshalb trägt jede Sitzung die Version
 * des Kontos; wer Zugänge beendet, erhöht sie, und jede Anfrage vergleicht. */
import * as repo from './repository/zugaenge';

const ZWISCHENSPEICHER_MS = 5_000;
const gemerkt = new Map<number, { version: number | null; bis: number }>();

/** null: Konto fehlt oder ist gesperrt. */
export function sitzungsVersionAusDb(uid: number): Promise<number | null> {
  return repo.sitzungsVersion(uid);
}

export async function aktuelleSitzungsVersion(uid: number): Promise<number | null> {
  const g = gemerkt.get(uid);
  if (g && g.bis > Date.now()) return g.version;
  const version = await repo.sitzungsVersion(uid);
  gemerkt.set(uid, { version, bis: Date.now() + ZWISCHENSPEICHER_MS });
  return version;
}

/** Vor dem Löschen der Zeilen aufrufen; liefert die neue Version. */
export async function erhoeheSitzungsVersion(uid: number): Promise<number> {
  const version = await repo.zaehleSitzungsVersionHoch(uid);
  gemerkt.delete(uid);
  return version;
}
