/**
 * Kam eine Barcode-Antwort aus einem GEPRÜFTEN Abgleich oder aus einer
 * Vermutung?
 * Ausführlich: docs/begruendungen/src/katalog/barcodeQuelle.ts.md#geprueft
 */

/** Wege, die eine KENNUNG abgleichen — keine Vermutung. */
export const GEPRUEFT: ReadonlySet<string> = new Set([
  // Die gescannte Zeichenkette IST eine Setnummer aus dem Katalog.
  'catalog_cache',
  // Die EAN steht nachweislich in den external_ids des Treffers.
  'rebrickable-ean',
  // Brickset kennt die EAN bzw. die Bestellnummer direkt.
  'brickset-ean',
  'brickset-item',
  // Direkter Abruf von /sets/<nummer>-1/ — die Nummer existiert oder nicht.
  'rebrickable-direct',
]);

/**
 * @returns true, wenn die Antwort GERATEN ist und der Mensch hinsehen muss.
 */
export function istVermutung(quelle: string | null | undefined): boolean {
  return !quelle || !GEPRUEFT.has(quelle);
}

