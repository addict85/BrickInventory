import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import * as db from '../../db/database';
import * as repo from './repository/auftraege';
import { logAndContinue } from '../infra/fehler';

/** Jede Belegung trägt die Kennung ihres Prozesses. Ein Prozess, der hart endet
 * (Speicher, Stromausfall), gibt nichts zurück; seine Sperre endet aber mit der
 * Verbindung, und der nächste Start übernimmt sofort statt nach der Frist. */
export const PROZESS = randomUUID();

export const belegKennung = (): string => `${PROZESS}/${randomUUID()}`;

let _sperre: PoolClient | null = null;

/** @returns übernommene Aufträge toter Prozesse */
export async function meldeProzessAn(): Promise<number> {
  if (!_sperre) {
    const c = await db.pool.connect();
    c.on('error', logAndContinue('auftraege:prozess-sperre'));
    await repo.halteProzessSperre(c, PROZESS);
    _sperre = c;
  }
  return repo.gibVerwaisteZurueck(_sperre, PROZESS);
}

export function meldeProzessAb(): void {
  _sperre?.release(true);
  _sperre = null;
}
