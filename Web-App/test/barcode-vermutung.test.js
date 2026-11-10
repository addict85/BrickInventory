/**
 * Eine geratene Setnummer muss als Vermutung erkennbar sein.
 * Ausführlich: docs/begruendungen/test/barcode-vermutung.test.js.md#kopf
 *
 * Gegenprobe (09.11.2026): istVermutung() nur noch `!quelle` → rot: „die zwei ratenden Wege …“
 * und „eine unbekannte Quelle gilt als Vermutung“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();
const { istVermutung, GEPRUEFT } = _req('src/katalog/barcodeQuelle.js');

test('geprüfte Wege sind keine Vermutung', () => {
  for (const quelle of ['catalog_cache', 'rebrickable-ean', 'brickset-ean', 'brickset-item', 'rebrickable-direct']) {
    assert.equal(istVermutung(quelle), false, `${quelle} gilt als Vermutung`);
  }
  // Selbstbeweis: Wäre die Liste leer, bestünde die Schleife oben nicht.
  assert.ok(GEPRUEFT.size >= 5, `nur ${GEPRUEFT.size} geprüfte Quellen — Liste geschrumpft?`);
});

test('die zwei ratenden Wege sind als Vermutung markiert', () => {
  assert.equal(
    istVermutung('rebrickable-search'),
    true,
    'Der Zweig wird erreicht, NACHDEM der exakte EAN-Abgleich fehlschlug — ' +
      'er nimmt das erste Suchergebnis, das nur "nach 2010" und "hat Teile" erfüllt.',
  );
  assert.equal(istVermutung('upcitemdb'), true, 'Eine Zahl aus einem Produkttitel ist keine geprüfte Kennung.');
});

test('eine unbekannte Quelle gilt als Vermutung', () => {
  // Der Kern der Positivliste: Ein achter Weg ist automatisch unsicher, statt
  // still als Treffer durchzugehen.
  for (const quelle of ['irgendwas-neues', '', null, undefined]) {
    assert.equal(istVermutung(quelle), true, `"${quelle}" ging als geprüft durch`);
  }
});

// Die Kandidaten-Regel selbst (Jahre, Mengenangaben, Rauten, Stellenzahlen,
// dreistellige Altsets) steht nicht mehr hier: Sie muss in BEIDEN Apps gleich
// ausfallen und wird deshalb gegen den gemeinsamen Korpus geprüft —
// test/abgleich-setnummer-korpus.test.js und shared/setnummer-korpus.json. Hier stand
// dieselbe Aufzählung ein zweites Mal, und nur die Web-Seite war damit gedeckt.
