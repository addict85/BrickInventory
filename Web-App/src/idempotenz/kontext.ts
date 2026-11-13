/** Was die Dienste des Bereichs bekommen: Zugang, Dienste tieferer Bereiche, Arbeitseinheit.
 * Getrennt von bereich.ts, damit ein Dienst seinen Typ ohne Importzyklus kennt. */
import type { Db } from '../../db/database';
import { bindeZugang, type Kontext } from '../infra/bereich';
import * as repository from './repository';

export interface IdempotenzAbhaengigkeiten {
  db: Db;
}

export const zugang = (db: Db) => ({
  repository: bindeZugang(db, repository),
});
export type IdempotenzKontext = Kontext<IdempotenzAbhaengigkeiten, ReturnType<typeof zugang>>;
