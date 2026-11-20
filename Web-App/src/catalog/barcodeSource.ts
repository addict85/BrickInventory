/** Whether a human has to look at a barcode hit depends on the path. */

export const CHECKED: ReadonlySet<string> = new Set([
  'catalog_cache',
  'rebrickable-ean',
  'brickset-ean',
  'brickset-item',
  'rebrickable-direct',
]);

export function isGuess(quelle: string | null | undefined): boolean {
  return !quelle || !CHECKED.has(quelle);
}
