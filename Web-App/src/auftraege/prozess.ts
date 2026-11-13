import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import * as repo from './repository/auftraege';
import { logAndContinue } from '../infra/fehler';
import type { AuftraegeDienste } from './bereich';
import { prozessStelle } from '../infra/bereich';

/** Jede Belegung trägt die Kennung ihres Prozesses. Ein Prozess, der hart endet
 * (Speicher, Stromausfall), gibt nichts zurück; seine Sperre endet aber mit der
 * Verbindung, und der nächste Start übernimmt sofort statt nach der Frist. */
export const PROZESS = randomUUID();

export const belegKennung = (): string => `${PROZESS}/${randomUUID()}`;

/** Die Sperrverbindung gehört zum Zugang, aus dessen Pool sie stammt. */
const sperre = () => auftraegeBereich().faecher.fach('prozessSperre', () => ({ client: null as PoolClient | null }));

/** @returns übernommene Aufträge toter Prozesse */
export async function meldeProzessAn(): Promise<number> {
  const s = sperre();
  if (!s.client) {
    const c = await auftraegeBereich().db.systemPool.connect();
    c.on('error', logAndContinue('auftraege:prozess-sperre'));
    await repo.halteProzessSperre(c, PROZESS);
    s.client = c;
  }
  return repo.gibVerwaisteZurueck(s.client, PROZESS);
}

export function meldeProzessAb(): void {
  const s = sperre();
  s.client?.release(true);
  s.client = null;
}

/** Die Dienste des Prozesses (startup/verdrahtung.ts) für Wege ohne eigenen Kontext. */
export const auftraegeBereich = prozessStelle<AuftraegeDienste>('auftraege');
