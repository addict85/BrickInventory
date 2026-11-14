/** Die öffentliche Seite des Bereichs: Andere Bereiche importieren nur von hier,
 * damit die Aufteilung frei bleibt; was die Datenbank braucht, ist ein Dienst (`t.bestand`). */

export {
  MAX_PAGE_SIZE,
  SET_PARTS_MAX_PAGE_SIZE,
  UNPAGED_LIMIT,
  clampPageSize,
  conditionFromAcquisitions,
  conditionsFromAcquisitions,
} from './gemeinsam';
export { normalisiereLagerort } from './lagerort';
export { mengenwunsch } from './manuelleMenge';
export { acquisitionTotals } from './acquisitions';
export { erzeugeBestand } from './bereich';
export type { BestandDienste, BestandKontext } from './bereich';
