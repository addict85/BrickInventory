/**
 * A guessed set number must be recognizable as a guess.
 *
 * Counter-check (09.11.2026): isGuess() only `!quelle` → red: “the two guessing paths …”
 * and “an unknown source counts as a guess”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();
const { isGuess, CHECKED } = _req('src/catalog/barcodeSource.js');

test('verified paths are not a guess', () => {
  for (const quelle of ['catalog_cache', 'rebrickable-ean', 'brickset-ean', 'brickset-item', 'rebrickable-direct']) {
    assert.equal(isGuess(quelle), false, `${quelle} gilt als Vermutung`);
  }
  // Self-proof: if the list were empty, the loop above would not pass.
  assert.ok(CHECKED.size >= 5, `nur ${CHECKED.size} geprüfte Quellen — Liste geschrumpft?`);
});

test('the two guessing paths are marked as a guess', () => {
  assert.equal(
    isGuess('rebrickable-search'),
    true,
    'Der Zweig wird erreicht, NACHDEM der exakte EAN-Abgleich fehlschlug — ' +
      'er nimmt das erste Suchergebnis, das nur "nach 2010" und "hat Teile" erfüllt.',
  );
  assert.equal(isGuess('upcitemdb'), true, 'Eine Zahl aus einem Produkttitel ist keine geprüfte Kennung.');
});

test('an unknown source counts as a guess', () => {
  // The core of the allow list: an eighth path is automatically uncertain instead of
  // silently passing as a hit.
  for (const quelle of ['irgendwas-neues', '', null, undefined]) {
    assert.equal(isGuess(quelle), true, `"${quelle}" ging als geprüft durch`);
  }
});

// The candidate rule itself (years, quantity notes, hashes, digit counts,
// three-digit old sets) is no longer here: it must turn out the same in BOTH apps
// and is therefore checked against the shared corpus —
// test/set-number-corpus.test.js and shared/setnummer-korpus.json; a second enumeration
// here covered only the web side.
