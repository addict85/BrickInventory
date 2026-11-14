/** Was die Fremdquellen bekommen: Zugang (Kontingent, Takt), Einstellungen für die
 * Schlüssel und die Aufträge für die Brickset-Wiedervorlage. Getrennt von bereich.ts,
 * damit ein Dienst seinen Typ ohne Importzyklus kennt. */
import { bindeZugang, type Kontext } from '../infra/bereich';
import type { Db } from '../../db/database';
import type { AuftraegeDienste } from '../auftraege';
import type { EinstellungenDienste } from '../einstellungen';
import * as apiKontingent from './repository/apiKontingent';
import * as apiTakt from './repository/apiTakt';
import type { Quellen } from './quellen';

export interface FremdquellenAbhaengigkeiten {
  db: Db;
  einstellungen: EinstellungenDienste;
  auftraege: AuftraegeDienste;
  /** Was ein Test statt der echten Klienten gibt; gelesen beim Aufruf (bereich.ts). */
  ersatz?: Partial<Quellen> | undefined;
}

export const zugang = (db: Db) => ({
  apiKontingent: bindeZugang(db, apiKontingent),
  apiTakt: bindeZugang(db, apiTakt),
});
export type FremdquellenKontext = Kontext<FremdquellenAbhaengigkeiten, ReturnType<typeof zugang>>;
