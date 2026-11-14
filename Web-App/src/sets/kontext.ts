import type { Db } from '../../db/database';
import type { AuftraegeDienste, Nacharbeit } from '../auftraege';
import type { BestandDienste } from '../bestand';
import type { FinanzenDienste } from '../finanzen';
import type { HaushaltDienste } from '../haushalt';
import type { KatalogDienste } from '../katalog';
import type { EinstellungenDienste } from '../einstellungen';
import type { KontoDienste } from '../konto';
import type { Kontext } from '../infra/bereich';

/** Was der Bereich von aussen bekommt, damit ein Test ihm einen eigenen Zugang geben kann; dass
 * alle Bereiche denselben nutzen, sichert baueDienste (startup/verdrahtung.ts). */
export interface SetsAbhaengigkeiten {
  db: Db;
  nacharbeit: Nacharbeit;
  katalog: KatalogDienste;
  finanzen: FinanzenDienste;
  haushalt: HaushaltDienste;
  auftraege: AuftraegeDienste;
  bestand: BestandDienste;
  einstellungen: EinstellungenDienste;
  konto: KontoDienste;
}
export type SetsKontext = Kontext<SetsAbhaengigkeiten, object>;
