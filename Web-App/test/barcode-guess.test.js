/**
 * Eine geratene Setnummer muss als Vermutung erkennbar sein.
 *
 * Gegenprobe (09.11.2026): isGuess() nur noch `!quelle` → rot: „die zwei ratenden Wege …“
 * und „eine unbekannte Quelle gilt als Vermutung“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();
const { isGuess, CHECKED } = _req('src/catalog/barcodeSource.js');

test('geprüfte Wege sind keine Vermutung', () => {
  for (const quelle of ['catalog_cache', 'rebrickable-ean', 'brickset-ean', 'brickset-item', 'rebrickable-direct']) {
    assert.equal(isGuess(quelle), false, `${quelle} gilt als Vermutung`);
  }
  // Selbstbeweis: Wäre die Liste leer, bestünde die Schleife oben nicht.
  assert.ok(CHECKED.size >= 5, `nur ${CHECKED.size} geprüfte Quellen — Liste geschrumpft?`);
});

test('die zwei ratenden Wege sind als Vermutung markiert', () => {
  assert.equal(
    isGuess('rebrickable-search'),
    true,
    'Der Zweig wird erreicht, NACHDEM der exakte EAN-Abgleich fehlschlug — ' +
      'er nimmt das erste Suchergebnis, das nur "nach 2010" und "hat Teile" erfüllt.',
  );
  assert.equal(isGuess('upcitemdb'), true, 'Eine Zahl aus einem Produkttitel ist keine geprüfte Kennung.');
});

test('eine unbekannte Quelle gilt als Vermutung', () => {
  // Der Kern der Positivliste: Ein achter Weg ist automatisch unsicher, statt
  // still als Treffer durchzugehen.
  for (const quelle of ['irgendwas-neues', '', null, undefined]) {
    assert.equal(isGuess(quelle), true, `"${quelle}" ging als geprüft durch`);
  }
});

// Die Kandidaten-Regel selbst (Jahre, Mengenangaben, Rauten, Stellenzahlen,
// dreistellige Altsets) steht nicht mehr hier: Sie muss in BEIDEN Apps gleich
// ausfallen und wird deshalb gegen den gemeinsamen Korpus geprüft —
// test/set-number-corpus.test.js und shared/setnummer-korpus.json; eine zweite Aufzählung
// hier deckte nur die Web-Seite.
