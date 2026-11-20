import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import * as repo from './repository/jobs';
import { reportError } from '../infra/fehler';
import type { JobsContext } from './context';

/** Jede Belegung trägt die Kennung ihres Prozesses. Ein Prozess, der hart endet
 * (Speicher, Stromausfall), gibt nichts zurück; seine Sperre endet aber mit der
 * Verbindung, und der nächste Start übernimmt sofort statt nach der Frist. */
export const PROCESS = randomUUID();

export const receiptId = (): string => `${PROCESS}/${randomUUID()}`;

/** Die Sperrverbindung gehört zum Zugang, aus dessen Pool sie stammt. */
const sperre = (k: JobsContext) => k.faecher.fach('prozessSperre', () => ({ client: null as PoolClient | null }));

/** @returns übernommene Aufträge toter Prozesse */
export async function reportProcessAn(k: JobsContext): Promise<number> {
  const s = sperre(k);
  if (!s.client) {
    const c = await k.db.systemPool.connect();
    c.on('error', e => reportError('auftraege:prozess-sperre', e));
    await repo.holdProcessLock(c, PROCESS);
    s.client = c;
  }
  return repo.giveOrphanedBack(s.client, PROCESS);
}

export function reportProcessAb(k: JobsContext): void {
  const s = sperre(k);
  s.client?.release(true);
  s.client = null;
}
