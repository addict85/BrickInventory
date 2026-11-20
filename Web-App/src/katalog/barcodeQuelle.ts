/** Ob der Mensch bei einem Barcode-Treffer hinsehen muss, hängt am Weg. */

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
