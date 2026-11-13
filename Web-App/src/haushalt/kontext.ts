/** Was die Dienste des Bereichs bekommen: Zugang, Dienste tieferer Bereiche, Arbeitseinheit.
 * Getrennt von bereich.ts, damit ein Dienst seinen Typ ohne Importzyklus kennt. */
import type { Db } from '../../db/database';
import { bindeZugang, type Kontext } from '../infra/bereich';
import type { EinstellungenDienste } from '../einstellungen';
import * as repository from './repository';

export interface HaushaltAbhaengigkeiten {
  db: Db;
  einstellungen: EinstellungenDienste;
}

export const zugang = (db: Db) => ({ repository: bindeZugang(db, repository) });
export type HaushaltKontext = Kontext<HaushaltAbhaengigkeiten, ReturnType<typeof zugang>>;
