/** The public face of the area; whatever needs the database is a service (`t.bestand`). */

export {
  MAX_PAGE_SIZE,
  SET_PARTS_MAX_PAGE_SIZE,
  UNPAGED_LIMIT,
  clampPageSize,
  conditionFromAcquisitions,
  conditionsFromAcquisitions,
} from './shared';
export { normalizeLocation } from './storageLocation';
export { quantityRequest as mengenwunsch } from './manualQuantity';
export { acquisitionTotals } from './acquisitions';
export { createInventory } from './area';
export type { InventoryServices, InventoryContext } from './area';
