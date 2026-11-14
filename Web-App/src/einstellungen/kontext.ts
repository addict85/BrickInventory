/** Was die Dienste des Bereichs bekommen: Zugang, Dienste tieferer Bereiche, Arbeitseinheit.
 * Getrennt von bereich.ts, damit ein Dienst seinen Typ ohne Importzyklus kennt. */
import type { Db } from '../../db/database';
import { bindeZugang, type Kontext } from '../infra/bereich';
import type { Faecher } from '../infra/zwischenspeicher';
import * as repository from './repository';

export interface EinstellungenAbhaengigkeiten {
  db: Db;
  /** Wer auf Änderungen globaler Werte horcht; erzeugeEinstellungen legt es an. */
  faecher: Faecher;
}

export const zugang = (db: Db) => ({ repository: bindeZugang(db, repository) });
export type EinstellungenKontext = Kontext<EinstellungenAbhaengigkeiten, ReturnType<typeof zugang>>;
