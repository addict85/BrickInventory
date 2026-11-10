/**
 * Die Abschlusszeile von `npm test` nennt, wie viele Browser- und Caddy-Dateien mangels Werkzeug nur
 * übersprungen wurden: Lokal fehlt Chrome oft, und die Dateien sind dann grün, ohne geprüft zu haben.
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln, zurückgenommen):
 *   A  in ohneWerkzeug() `chromeDa ? 0 : browser.length` durch `0` ersetzt → rot: „ohne Chrome und Caddy“
 *   B  im catch um chrome() `chromeDa = false` gesetzt → rot: „mit REQUIRE_BROWSER=1 zählt nichts
 *      als übersprungen“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

/** Zwei Wegwerf-Testdateien: eine Browser-Datei, eine, die Caddy braucht. */
function dateien(t) {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'test-lauf-uebersprungen-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const browser = path.join(ordner, 'leer-browser.test.js');
  const caddy = path.join(ordner, 'leer-caddy.test.js');
  fs.writeFileSync(browser, "require('node:test')('leer', () => {});\n");
  fs.writeFileSync(caddy, "// braucht CADDY_BIN\nrequire('node:test')('leer', () => {});\n");
  return [browser, caddy];
}

/** test-lauf.js als Kind, ohne Datenbank und ohne Neubau; `zusatz` setzt die Werkzeug-Variablen. */
function abschluss(t, /** @type {Record<string, string>} */ zusatz) {
  const env = { ...process.env, TEST_LAUF_GEBAUT: '1', PATH: path.dirname(process.execPath), ...zusatz };
  for (const k of [
    'TEST_DATABASE_URL',
    'TEST_DB_VORLAGE',
    'TEST_DB_BASIS',
    'TEST_DB_EIGEN',
    'NODE_TEST_CONTEXT',
    'CHROME_BIN',
    'CADDY_BIN',
    'REQUIRE_BROWSER',
    'REQUIRE_CADDY',
  ])
    if (!(k in zusatz)) delete env[k];
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'test-lauf.js'), ...dateien(t)], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: 100_000,
  });
  assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-2000));
  return r.stdout.trim().split('\n').pop() ?? '';
}

test('ohne Chrome und Caddy nennt die Abschlusszeile beide Zahlen', { timeout: 120_000 }, t => {
  // Steht auf dem Rechner ein Chrome an einem Standardort, findet der Lauf ihn auch ohne CHROME_BIN.
  const vorher = { CHROME_BIN: process.env.CHROME_BIN, REQUIRE_BROWSER: process.env.REQUIRE_BROWSER };
  delete process.env.CHROME_BIN;
  delete process.env.REQUIRE_BROWSER;
  const chromeDa = !!require('./helpers/app-browser').chrome();
  for (const [k, v] of Object.entries(vorher)) if (v !== undefined) process.env[k] = v;
  const zeile = abschluss(t, {});
  assert.match(
    zeile,
    new RegExp(`übersprungen: ${chromeDa ? 0 : 1} Browser-Dateien ohne Chrome \\(CHROME_BIN, REQUIRE_BROWSER=1\\)`),
  );
  assert.match(zeile, /, 1 Caddy-Dateien ohne Caddy \(CADDY_BIN, REQUIRE_CADDY=1\)$/);
});

test('mit Chrome und Caddy ist nichts übersprungen', { timeout: 120_000 }, t => {
  const zeile = abschluss(t, { CHROME_BIN: process.execPath, CADDY_BIN: process.execPath });
  assert.match(zeile, /übersprungen: 0 Browser-Dateien ohne Chrome .*, 0 Caddy-Dateien ohne Caddy/);
});

test('mit REQUIRE_BROWSER=1 zählt nichts als übersprungen', { timeout: 120_000 }, t => {
  // Dann scheitert jede echte Browser-Datei laut; die Wegwerf-Datei hier fragt nicht nach Chrome.
  const zeile = abschluss(t, { CHROME_BIN: '/gibt/es/nicht', REQUIRE_BROWSER: '1', REQUIRE_CADDY: '1' });
  assert.match(zeile, /übersprungen: 0 Browser-Dateien .*, 0 Caddy-Dateien/);
});
