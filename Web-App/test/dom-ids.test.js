/**
 * DOM-Konsistenz: Jede statisch per G('...') referenzierte Element-ID aus den
 * Frontend-Modulen muss in index.html existieren. Genau diese Fehlerklasse
 * (JS greift auf umbenannte/entfernte IDs zu) fällt sonst erst zur Laufzeit
 * als stiller TypeError auf.
 *
 * Geprüft werden die statischen String-Literale G('id') — dynamische Aufrufe
 * wie G('tab-'+name) werden bewusst ignoriert.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
  //
  // Der Prüfer kannte bisher nur Auszeichnung — ein `<div id="…">` im Markup
  // oder in einem Template-String. Der eigene Scrollbalken (Nachtrag 94)
  // entsteht aber in JavaScript, und zwar aus gutem Grund: app.bundle.js läuft
  // vor dem Ende des Body, ein dort notiertes Element gäbe es beim Start noch
  // nicht. Ohne diese Zeile meldete der Prüfer es als fehlend, und man
  // gewöhnte sich an, ihn zu übergehen.
  for (const m of src.matchAll(/\.id\s*=\s*'([^']+)'/g)) knownIds.add(m[1]);
  for (const m of src.matchAll(/\.id\s*=\s*"([^"]+)"/g)) knownIds.add(m[1]);
};
collect(fs.readFileSync(path.join(PUB, 'index.html'), 'utf8'));
for (const f of JS_FILES) collect(fs.readFileSync(path.join(PUB, 'js', f), 'utf8'));

// Bewusst tolerierte Altlasten: Referenz ist im Code null-geprüft (if(uel)),
// das Element wurde aus dem Header entfernt. Neue Einträge hier nur mit Grund.
const ALLOWED_MISSING = new Set(['uname']);

for (const file of JS_FILES) {
  test(`G('...')-IDs aus ${file} existieren in index.html`, () => {
    const src = fs.readFileSync(path.join(PUB, 'js', file), 'utf8');
    const ids = [...src.matchAll(/G\(\s*'([^'+]+)'\s*\)/g)].map(m => m[1]);
    const missing = [...new Set(ids)].filter(id => !knownIds.has(id) && !ALLOWED_MISSING.has(id));
    assert.deepEqual(missing, [], `Fehlende IDs: ${missing.join(', ')}`);
  });
}

test('jede Moduldatei hängt im Bündel-Graphen', () => {
  // ── Was diese beiden Tests früher prüften ────────────────────────────────
  // Hier standen zwei Prüfungen auf doppelte Top-Level-Deklarationen über die
  // Dateigrenzen hinweg. Sie waren nötig, weil alle Dateien sich EINEN globalen
  // Gültigkeitsbereich teilten: Ein zweites `const X` in einer anderen Datei
  // brach die betroffene Datei komplett ab ("Identifier has already been
  // declared"), und dann war keine ihrer Funktionen mehr definiert.
  //
  // Mit ES-Modulen kann das nicht mehr passieren — jede Datei hat ihren eigenen
  // Bereich, gleichnamige Deklarationen sind unabhängig voneinander. esbuild
  // meldet eine echte Doppeldeklaration INNERHALB einer Datei beim Bauen als
  // harten Fehler (genau so ist die doppelte closeAcqModal() in 07-admin.js
  // aufgefallen, die vorher jahrelang als toter Code danebenlag).
  //
  // Was dafür neu abgesichert werden muss: dass jede Datei überhaupt im
  // Modulgraphen hängt. Eine nicht importierte Datei würde stillschweigend nie
  // ausgeliefert.
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
