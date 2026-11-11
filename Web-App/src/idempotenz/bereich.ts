/** Die Fabrik des Bereichs: Wer die Datenbank braucht, nimmt den Zugang als
 * ersten Parameter; erzeugeIdempotenz bindet ihn einmal für alle. So greift kein
 * Modul selbst auf den Zugang des Prozesses zu, und ein Test gibt einen eigenen. */
import type { Db } from '../../db/database';
import { bindeZugang } from '../infra/bereich';
import * as repository from './repository';

export interface IdempotenzKontext {
  db: Db;
}

export function erzeugeIdempotenz(k: IdempotenzKontext) {
  const { db } = k;
  return {
    db,
    repository: bindeZugang(db, repository),
  };
}

export type IdempotenzDienste = ReturnType<typeof erzeugeIdempotenz>;
