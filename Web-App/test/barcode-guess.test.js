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
  for (const source of ['catalog_cache', 'rebrickable-ean', 'brickset-ean', 'brickset-item', 'rebrickable-direct']) {
    assert.equal(isGuess(source), false, `${source} counts as a guess`);
  }
  // Self-proof: if the list were empty, the loop above would not pass.
  assert.ok(CHECKED.size >= 5, `only ${CHECKED.size} checked sources — has the list shrunk?`);
});

test('the two guessing paths are marked as a guess', () => {
  assert.equal(
    isGuess('rebrickable-search'),
    true,
    'The branch is reached AFTER the exact EAN match failed — ' +
      'it takes the first search result that only satisfies "after 2010" and "has parts".',
  );
  assert.equal(isGuess('upcitemdb'), true, 'A number from a product title is not a checked identifier.');
});

test('an unknown source counts as a guess', () => {
  // The core of the allow list: an eighth path is automatically uncertain instead of
  // silently passing as a hit.
  for (const source of ['irgendwas-neues', '', null, undefined]) {
    assert.equal(isGuess(source), true, `"${source}" passed as checked`);
  }
});

// The candidate rule itself (years, quantity notes, hashes, digit counts,
// three-digit old sets) is no longer here: it must turn out the same in BOTH apps
// and is therefore checked against the shared corpus —
// test/set-number-corpus.test.js and shared/setnummer-korpus.json; a second enumeration
// here covered only the web side.
