/**
 * The log of the import bar: ONE version, and no line without a name.
 *
 * Counter-checks (measured 10.11.2026):
 *   A  a second function logRow() in set-csv-import.js → red:
 *      “only ONE version …”
 *   B  'csv.items_progress' in German to “{done} / {total} Sets” → red:
 *      “the progress text …”
 * That no line arises past logRow is checked by the result in
 * csv-import-result-ui.test.js (“result list with lines”).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const withoutComments = (/** @type {string} */ s) => require('./helpers/sources').withoutComments(s);

const PROGRESS = 'public/js/progress.js';

test('only ONE version builds the line for the import log', () => {
  const sources = fs
    .readdirSync(path.join(ROOT, 'public', 'js'))
    .filter(n => n.endsWith('.js') && n !== 'app.bundle.js')
    .map(n => ['public/js/' + n, withoutComments(read('public/js/' + n))]);
  // Self-proof: if the search found hardly any files, the rule would be vacuously true.
  assert.ok(sources.length >= 20, `Only ${sources.length} UI files found — the search no longer matches`);

  const defined = sources.filter(([, js]) => /function logRow\s*\(/.test(js));
  assert.deepEqual(
    defined.map(([n]) => n),
    [PROGRESS],
    'logRow() belongs in the tree exactly once. Two versions mean ' +
      'two places where the next barrier is missing — and that was exactly ' +
      'the case when the same three lines were here and in „sammlung.js“.',
  );
});

test('the progress text does not talk about sets', () => {
  // The same bar carries sets, parts and minifigures; checked on the loaded dictionaries.
  const { de, en } = require('./helpers/sources').loadTranslations();
  assert.equal(de['csv.sets_progress'] ?? en['csv.sets_progress'], undefined, 'the old key is back');
  for (const [language, text] of [
    ['de', de['csv.items_progress']],
    ['en', en['csv.items_progress']],
  ]) {
    assert.ok(text, `csv.items_progress is missing (${language})`);
    assert.doesNotMatch(text, /sets?\b/i, `${language}: „${text}“ names sets`);
  }
});
