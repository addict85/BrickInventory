/** Was die Dienste des Bereichs bekommen: Zugang, Dienste tieferer Bereiche, Arbeitseinheit.
 * Getrennt von bereich.ts, damit ein Dienst seinen Typ ohne Importzyklus kennt. */
import type { Db } from '../../db/database';
import { bindeZugang, type Kontext } from '../infra/bereich';
import * as merkliste from './repository/merkliste';
import * as wantedListe from './repository/wantedListe';
import type { EinstellungenDienste } from '../einstellungen';
import type { HaushaltDienste } from '../haushalt';
import type { KatalogDienste } from '../katalog';
import type { FinanzenDienste } from '../finanzen';
import type { SetsDienste } from '../sets';
import type { Nacharbeit } from '../auftraege';

export interface MerklisteAbhaengigkeiten {
  db: Db;
  einstellungen: EinstellungenDienste;
  haushalt: HaushaltDienste;
  katalog: KatalogDienste;
  finanzen: FinanzenDienste;
  nacharbeit: Nacharbeit;
  sets: SetsDienste;
}

export const zugang = (db: Db) => ({
  merkliste: bindeZugang(db, merkliste),
  wantedListe: bindeZugang(db, wantedListe),
});
export type MerklisteKontext = Kontext<MerklisteAbhaengigkeiten, ReturnType<typeof zugang>>;
