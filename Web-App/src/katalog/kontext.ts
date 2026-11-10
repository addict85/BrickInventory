import type { Db } from '../../db/database';

/** Was der Bereich Katalog von aussen bekommt: Kein Dienst greift selbst auf den
 * Zugang des Prozesses zu, damit ein Test (oder ein zweiter Prozess) ihm einen
 * eigenen geben kann. Gebaut wird er in startup/verdrahtung.ts. */
export interface KatalogKontext {
  db: Db;
}
