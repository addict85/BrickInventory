import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import * as repo from './repository/auftraege';
import { meldeFehler } from '../infra/fehler';
import type { AuftraegeKontext } from './kontext';

/** Jede Belegung trägt die Kennung ihres Prozesses. Ein Prozess, der hart endet
 * (Speicher, Stromausfall), gibt nichts zurück; seine Sperre endet aber mit der
 * Verbindung, und der nächste Start übernimmt sofort statt nach der Frist. */
export const PROZESS = randomUUID();

export const belegKennung = (): string => `${PROZESS}/${randomUUID()}`;

/** Die Sperrverbindung gehört zum Zugang, aus dessen Pool sie stammt. */
const sperre = (k: AuftraegeKontext) => k.faecher.fach('prozessSperre', () => ({ client: null as PoolClient | null }));

/** @returns übernommene Aufträge toter Prozesse */
export async function meldeProzessAn(k: AuftraegeKontext): Promise<number> {
  const s = sperre(k);
  if (!s.client) {
    const c = await k.db.systemPool.connect();
    c.on('error', e => meldeFehler('auftraege:prozess-sperre', e));
    await repo.halteProzessSperre(c, PROZESS);
    s.client = c;
  }
  return repo.gibVerwaisteZurueck(s.client, PROZESS);
}

export function meldeProzessAb(k: AuftraegeKontext): void {
  const s = sperre(k);
  s.client?.release(true);
  s.client = null;
}
