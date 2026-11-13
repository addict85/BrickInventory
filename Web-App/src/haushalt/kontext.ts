/** Was die Dienste des Bereichs bekommen: Zugang und Arbeitseinheit.
 * Getrennt von bereich.ts, damit ein Dienst seinen Typ ohne Importzyklus kennt. */
import type { Db } from '../../db/database';
import { bindeZugang, type Kontext } from '../infra/bereich';
import * as repository from './repository';

export interface HaushaltAbhaengigkeiten {
  db: Db;
}

export const zugang = (db: Db) => ({ repository: bindeZugang(db, repository, ['verknuepfe']) });
export type HaushaltKontext = Kontext<HaushaltAbhaengigkeiten, ReturnType<typeof zugang>>;
