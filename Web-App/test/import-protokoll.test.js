/**
 * Das Protokoll des Import-Balkens: EINE Fassung, und keine Zeile ohne Namen.
 *
 * Gegenproben (10.11.2026 gemessen):
 *   A  in set-csv-import.js eine zweite function protokollZeile() → rot:
 *      „nur EINE Fassung …“
 *   B  'csv.items_progress' im Deutschen auf „{done} / {total} Sets“ → rot:
 *      „der Fortschrittstext …“
 * Dass keine Zeile an protokollZeile vorbei entsteht, prüft das Ergebnis in
 * csv-import-ergebnis-oberflaeche.test.js („Ergebnisliste mit Zeilen“).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lies = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const ohneKommentare = (/** @type {string} */ s) => require('./helpers/sources').ohneKommentare(s);

const FORTSCHRITT = 'public/js/fortschritt.js';

test('nur EINE Fassung baut die Zeile fürs Import-Protokoll', () => {
  const quellen = fs
    .readdirSync(path.join(ROOT, 'public', 'js'))
    .filter(n => n.endsWith('.js') && n !== 'app.bundle.js')
    .map(n => ['public/js/' + n, ohneKommentare(lies('public/js/' + n))]);
  // Selbstnachweis: Fände die Suche kaum Dateien, wäre die Regel leer wahr.
  assert.ok(quellen.length >= 20, `Nur ${quellen.length} Oberflächen-Dateien gefunden — die Suche greift nicht mehr`);

  const definiert = quellen.filter(([, js]) => /function protokollZeile\s*\(/.test(js));
  assert.deepEqual(
    definiert.map(([n]) => n),
    [FORTSCHRITT],
    'protokollZeile() gehört genau einmal in den Baum. Zwei Fassungen heissen ' +
      'zwei Stellen, an denen die nächste Schranke fehlt — und genau das war ' +
      'der Fall, als dieselben drei Zeilen hier und in gallery.js standen.',
  );
});

test('der Fortschrittstext spricht nicht von Sets', () => {
  // Derselbe Balken trägt Sets, Teile und Minifiguren; geprüft an den geladenen Wörterbüchern.
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
