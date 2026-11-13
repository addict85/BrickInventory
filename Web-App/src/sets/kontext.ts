import type { Db } from '../../db/database';
import type { AuftraegeDienste, Nacharbeit } from '../auftraege';
import type { BestandDienste } from '../bestand';
import type { FinanzenDienste } from '../finanzen';
import type { KatalogDienste } from '../katalog';
import type { EinstellungenDienste } from '../einstellungen';
import type { KontoDienste } from '../konto';
import type { Kontext } from '../infra/bereich';

/** Was der Bereich von aussen bekommt: Ein Dienst greift nie selbst auf den
 * Zugang des Prozesses zu, auch nicht über Katalog, Finanzen oder Aufträge, damit
 * ein Test (oder ein zweiter Prozess) ihm einen eigenen geben kann. Die Dienste
 * dieser Bereiche laufen über denselben Zugang (erzeugeSets prüft das). Gebaut
 * wird er in startup/verdrahtung.ts. */
export interface SetsAbhaengigkeiten {
  db: Db;
  nacharbeit: Nacharbeit;
  katalog: KatalogDienste;
  finanzen: FinanzenDienste;
  auftraege: AuftraegeDienste;
  bestand: BestandDienste;
  einstellungen: EinstellungenDienste;
  konto: KontoDienste;
}
export type SetsKontext = Kontext<SetsAbhaengigkeiten, object>;
