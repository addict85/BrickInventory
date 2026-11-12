/** Ob der Mensch bei einem Barcode-Treffer hinsehen muss, hängt am Weg. */

export const GEPRUEFT: ReadonlySet<string> = new Set([
  'catalog_cache',
  'rebrickable-ean',
  'brickset-ean',
  'brickset-item',
  'rebrickable-direct',
]);

export function istVermutung(quelle: string | null | undefined): boolean {
  return !quelle || !GEPRUEFT.has(quelle);
}
