import type { Db } from '../../db/database';
import type { Nacharbeit } from '../auftraege';

/** Was der Bereich von aussen bekommt: Ein Dienst greift nie selbst auf den
 * Zugang des Prozesses zu, damit ein Test (oder ein zweiter Prozess) ihm einen
 * eigenen geben kann. Gebaut wird er in startup/verdrahtung.ts. */
export interface SetsKontext {
  db: Db;
  nacharbeit: Nacharbeit;
}
