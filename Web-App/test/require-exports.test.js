/**
 * Späte require()-Aufrufe zwischen Servermodulen gibt es nicht mehr.
 *
 * Gegenprobe (31.10.2026): `const { konfig } = require('./konfig')` in
 * src/infra/appPaths.ts → rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ROOT, buildAndRequire, ohneKommentare } = require('./helpers/sources');
const DIST = path.join(ROOT, 'dist');

/** Alle .ts-Quellen des Servers (ohne Tests, Skripte und Frontend). */
function quellDateien() {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', 'public', 'test', 'scripts', 'types'].includes(e.name)) continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith('.ts')) out.push(abs);
    }
  })(ROOT);
  return out;
}

test('kein Servermodul holt ein anderes per spätem require()', () => {
  const dateien = quellDateien();
  assert.ok(dateien.length > 100, `Nur ${dateien.length} Quelldateien gefunden — die Prüfung liefe ins Leere`);
  const treffer = [];
  for (const datei of dateien) {
    // `import x = require('./y')` ist ein Import (TypeScript prüft ihn), kein später Aufruf.
    const src = ohneKommentare(fs.readFileSync(datei, 'utf8')).replace(
      /^\s*import\s+\w+\s*=\s*require\([^)]*\);?/gm,
      '',
    );
    for (const m of src.matchAll(/\brequire\(\s*['"](\.[^'"]*)['"]/g))
      treffer.push(`${path.relative(ROOT, datei)}: require('${m[1]}')`);
  }
  assert.deepEqual(treffer, [], 'Statt require() einen Import benutzen — Pfad und Name prüft dann tsc.');
});

// ═══════════════════════════════════════════════════════════════════════════
// Dieselbe Frage für die TESTS: laden sie Module, die es noch gibt?
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Der Anlass: set-condition-aggregate.test.js holte auf Zeile
 * 679 `utils/handlers.js` — aufgeteilt seit. Der Aufruf steht auf
 * DATEIEBENE, also starb die ganze Datei beim Laden; die zehn Prüfungen
 * darunter liefen nie mehr. Sichtbar war das nur an einer Zahl („nicht ok" für …
 */
test('kein Test holt ein Modul aus dist/, das es nicht gibt', () => {
  buildAndRequire(); // stellt sicher, dass dist/ steht
  const dir = path.join(ROOT, 'test');
  const fehlend = [];
  let geprueft = 0;

  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.test.js'))) {
    const src = ohneKommentare(fs.readFileSync(path.join(dir, f), 'utf8'));
    // Bewusst nicht an EINER Aufrufform festgemacht: Die Tests holen mal über
    // `buildAndRequire()('x')`, mal über einen zwischengespeicherten `req('x')`.
    // Gesucht wird deshalb, was beide gemeinsam haben — der Modulpfad selbst.
    for (const m of src.matchAll(
      /['"]((?:utils|routes|db|jobs|clients|startup)\/[A-Za-z0-9_/-]+\.js|server\.js)['"]/g,
    )) {
      geprueft++;
      if (!fs.existsSync(path.join(DIST, m[1]))) fehlend.push(`${f}: ${m[1]}`);
    }
  }

  // Untergrenze aus demselben Grund wie oben: Bricht das Suchmuster, prüfte
  // diese Regel stillschweigend nichts mehr.
  assert.ok(geprueft > 10, `Nur ${geprueft} Modulpfade gefunden — das Muster greift nicht mehr`);
  assert.deepEqual(fehlend, [], `Test holt ein Modul, das es in dist/ nicht gibt:\n  ${fehlend.join('\n  ')}`);
});
