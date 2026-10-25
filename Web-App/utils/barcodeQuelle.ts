/**
 * Kam eine Barcode-Antwort aus einem GEPRÜFTEN Abgleich oder aus einer
 * Vermutung?
 * Ausführlich: docs/begruendungen/utils/barcodeQuelle.ts.md#geprueft
 */

/** Wege, die eine KENNUNG abgleichen — keine Vermutung. */
const GEPRUEFT: ReadonlySet<string> = new Set([
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
function istVermutung(quelle: string | null | undefined): boolean {
  return !quelle || !GEPRUEFT.has(quelle);
}

export { istVermutung, GEPRUEFT };
