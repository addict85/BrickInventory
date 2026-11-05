/**
 * DOM-Konsistenz: Jede statisch per G('...') referenzierte Element-ID aus den
 * Frontend-Modulen muss in index.html existieren. Genau diese Fehlerklasse
 * (JS greift auf umbenannte/entfernte IDs zu) fällt sonst erst zur Laufzeit
 * als stiller TypeError auf.
 * Ausführlich: docs/begruendungen/test/dom-ids.test.js.md#kopf
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ohneKommentare } = require('./helpers/sources');

const PUB = path.join(__dirname, '..', 'public');
// app.bundle.js ist ein BUILD-ERGEBNIS (scripts/build-frontend.js verkettet die
// Quelldateien darin) und liegt nur lokal/im Image, nicht im Repo. Würde es
// mitgeprüft, meldete jeder Test doppelte Deklarationen — einmal aus der
// Quelle, einmal aus dem Bündel.
const JS_FILES = fs.readdirSync(path.join(PUB, 'js'))
  .filter(f => f.endsWith('.js'))
  .filter(f => f !== 'app.bundle.js' && !f.startsWith('.'));

// Bekannte IDs = index.html + alle in JS-Templates erzeugten id="..."-Literale
// (viele Modale bauen ihren Inhalt zur Laufzeit als Template-String auf).
const knownIds = new Set();
const collect = src => {
  for (const m of src.matchAll(/id=\\?"([^"\\]+)\\?"/g)) knownIds.add(m[1]);
  for (const m of src.matchAll(/id='([^']+)'/g)) knownIds.add(m[1]);
  // Auch Elemente, die der Code SELBST erzeugt: `el.id = 'name'`.
  // Ausführlich: docs/begruendungen/test/dom-ids.test.js.md#for-stelle
  for (const m of src.matchAll(/\.id\s*=\s*'([^']+)'/g)) knownIds.add(m[1]);
  for (const m of src.matchAll(/\.id\s*=\s*"([^"]+)"/g)) knownIds.add(m[1]);
  // Und der vierte Weg: Der Ansichts-Baustein setzt die id als OPTION.
  // Ausführlich: docs/begruendungen/test/dom-ids.test.js.md#for-stelle-2
  for (const m of src.matchAll(/wertId:\s*'([^']+)'/g)) knownIds.add(m[1]);
  for (const m of src.matchAll(/wertId:\s*"([^"]+)"/g)) knownIds.add(m[1]);
  // Und der fuenfte Weg: Der Lagerort-Baustein erzeugt ZWEI Elemente aus
  // einer Kennung — das Textfeld `id` und die Auswahl `id-sel`
  // (07-admin.js, lagerortBlock). Seit das Feld ein Auswahlfeld mit
  // Neuerfassung ist, steht das id-Literal nicht mehr an der Aufrufstelle, …
  // Ausführlich: docs/begruendungen/test/dom-ids.test.js.md#for-stelle-3
  for (const m of src.matchAll(/lagerortBlock\(\s*'([^']+)'/g)) {
    knownIds.add(m[1]);
    knownIds.add(m[1] + '-sel');
  }
};
collect(fs.readFileSync(path.join(PUB, 'index.html'), 'utf8'));
for (const f of JS_FILES) collect(fs.readFileSync(path.join(PUB, 'js', f), 'utf8'));

// Ausnahmen — und die Liste ist LEER, mit Absicht.
// Ausführlich: docs/begruendungen/test/dom-ids.test.js.md#allowed-missing
const ALLOWED_MISSING = new Set();

for (const file of JS_FILES) {
  test(`G('...')-IDs aus ${file} existieren in index.html`, () => {
    // ohneKommentare: Gesucht wird nach IDs im CODE. Ein Erklärkommentar, der
    // beschreibt, welches G('…') hier früher stand und warum es weg ist, ist
    // keine Verwendung — ohne diesen Schritt meldet der Test eine ID, die
    // niemand mehr abruft. Dieselbe Falle, gegen die es helpers/sources.js …
    // Ausführlich: docs/begruendungen/test/dom-ids.test.js.md#src-stelle
    const src = ohneKommentare(fs.readFileSync(path.join(PUB, 'js', file), 'utf8'));
    const ids = [...src.matchAll(/G\(\s*'([^'+]+)'\s*\)/g)].map(m => m[1]);
    const missing = [...new Set(ids)].filter(id => !knownIds.has(id) && !ALLOWED_MISSING.has(id));
    assert.deepEqual(missing, [], `Fehlende IDs: ${missing.join(', ')}`);
  });
}

test('jede Moduldatei hängt im Bündel-Graphen', () => {
  // Was diese beiden Tests früher prüften
  // Ausführlich: docs/begruendungen/test/dom-ids.test.js.md#stelle
  const { STANDALONE } = require('../scripts/build-frontend.js');
  const entry = fs.readFileSync(path.join(PUB, 'js', 'main.js'), 'utf8');
  const imported = new Set(
    [...entry.matchAll(/from\s+'\.\/([^']+)'|import\s+'\.\/([^']+)'/g)]
      .map(m => m[1] || m[2]));
  const actual = fs.readdirSync(path.join(PUB, 'js')).filter(f => f.endsWith('.js'));
  const orphans = actual.filter(f =>
    !STANDALONE.has(f) && !imported.has(f) && f !== '00-registry.js');
  assert.deepEqual(orphans, [],
    `Nicht im Modulgraphen und damit nie ausgeliefert: ${orphans.join(', ')}`);
});
