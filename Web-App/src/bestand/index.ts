/** Die öffentliche Seite des Bereichs; was die Datenbank braucht, ist ein Dienst (`t.bestand`). */

export {
  MAX_PAGE_SIZE,
  SET_PARTS_MAX_PAGE_SIZE,
  UNPAGED_LIMIT,
  clampPageSize,
  conditionFromAcquisitions,
  conditionsFromAcquisitions,
} from './gemeinsam';
export { normalizeLocation } from './lagerort';
export { mengenwunsch } from './manuelleMenge';
export { acquisitionTotals } from './acquisitions';
export { createInventory } from './bereich';
export type { InventoryServices, InventoryContext } from './bereich';
