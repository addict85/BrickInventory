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
const lies = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const ohneKommentare = (/** @type {string} */ s) => require('./helpers/sources').ohneKommentare(s);

const PROGRESS = 'public/js/progress.js';

test('only ONE version builds the line for the import log', () => {
  const quellen = fs
    .readdirSync(path.join(ROOT, 'public', 'js'))
    .filter(n => n.endsWith('.js') && n !== 'app.bundle.js')
    .map(n => ['public/js/' + n, ohneKommentare(lies('public/js/' + n))]);
  // Self-proof: if the search found hardly any files, the rule would be vacuously true.
  assert.ok(quellen.length >= 20, `Nur ${quellen.length} Oberflächen-Dateien gefunden — die Suche greift nicht mehr`);

  const definiert = quellen.filter(([, js]) => /function logRow\s*\(/.test(js));
  assert.deepEqual(
    definiert.map(([n]) => n),
    [PROGRESS],
    'logRow() gehört genau einmal in den Baum. Zwei Fassungen heissen ' +
      'zwei Stellen, an denen die nächste Schranke fehlt — und genau das war ' +
      'der Fall, als dieselben drei Zeilen hier und in sammlung.js standen.',
  );
});

test('the progress text does not talk about sets', () => {
  // The same bar carries sets, parts and minifigures; checked on the loaded dictionaries.
  const { de, en } = require('./helpers/sources').loadTranslations();
  assert.equal(de['csv.sets_progress'] ?? en['csv.sets_progress'], undefined, 'der alte Schlüssel ist zurück');
  for (const [sprache, text] of [
    ['de', de['csv.items_progress']],
    ['en', en['csv.items_progress']],
  ]) {
    assert.ok(text, `csv.items_progress fehlt (${sprache})`);
    assert.doesNotMatch(text, /sets?\b/i, `${sprache}: „${text}“ nennt Sets`);
  }
});
