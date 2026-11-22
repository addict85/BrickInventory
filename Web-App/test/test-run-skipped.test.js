/**
 * The closing line of `npm test` names how many browser and Caddy files were only
 * skipped for lack of tooling: locally Chrome is often missing, and the files are then green without having checked.
 *
 * Counter-checks (measured 10.11.2026, each on its own, reverted):
 *   A  in withoutTool() `chromeDa ? 0 : browser.length` replaced by `0` → red: “without Chrome and Caddy”
 *   B  in the catch around chrome() `chromeDa = false` set → red: “with REQUIRE_BROWSER=1 nothing counts
 *      as skipped”
 *   C  in main() the line forcing REQUIRE_BROWSER removed → red: “without SKIP_BROWSER=1 the files run
 *      with REQUIRE_BROWSER=1” (measured 22.11.2026)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

/** Two throwaway test files: a browser file, one that needs Caddy. */
function dateien(t, browserBody = '') {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'test-lauf-uebersprungen-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const browser = path.join(ordner, 'leer-browser.test.js');
  const caddy = path.join(ordner, 'leer-caddy.test.js');
  fs.writeFileSync(browser, `require('node:test')('leer', () => {${browserBody}});\n`);
  fs.writeFileSync(caddy, "// braucht CADDY_BIN\nrequire('node:test')('leer', () => {});\n");
  return [browser, caddy];
}

/** test-run.js as a child, without a database and without a rebuild; `zusatz` sets the tool variables. */
function abschluss(t, /** @type {Record<string, string>} */ zusatz, { browserBody = '' } = {}) {
  const env = { ...process.env, TEST_RUN_BUILT: '1', PATH: path.dirname(process.execPath), ...zusatz };
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
    'SKIP_BROWSER',
  ])
    if (!(k in zusatz)) delete env[k];
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'test-run.js'), ...dateien(t, browserBody)], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: 100_000,
  });
  assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-2000));
  return r.stdout.trim().split('\n').pop() ?? '';
}

test('without Chrome and Caddy the closing line names both numbers', { timeout: 120_000 }, t => {
  // If a Chrome stands at a standard location on the machine, the run finds it even without CHROME_BIN.
  const vorher = { CHROME_BIN: process.env.CHROME_BIN, REQUIRE_BROWSER: process.env.REQUIRE_BROWSER };
  delete process.env.CHROME_BIN;
  delete process.env.REQUIRE_BROWSER;
  const chromeDa = !!require('./helpers/app-browser').chrome();
  for (const [k, v] of Object.entries(vorher)) if (v !== undefined) process.env[k] = v;
  const row = abschluss(t, { SKIP_BROWSER: '1' });
  assert.match(
    row,
    new RegExp(`übersprungen: ${chromeDa ? 0 : 1} Browser-Dateien ohne Chrome \\(CHROME_BIN, SKIP_BROWSER=1\\)`),
  );
  assert.match(row, /, 1 Caddy-Dateien ohne Caddy \(CADDY_BIN, REQUIRE_CADDY=1\)$/);
});

test('with Chrome and Caddy nothing is skipped', { timeout: 120_000 }, t => {
  const row = abschluss(t, { CHROME_BIN: process.execPath, CADDY_BIN: process.execPath });
  assert.match(row, /übersprungen: 0 Browser-Dateien ohne Chrome .*, 0 Caddy-Dateien ohne Caddy/);
});

test('with REQUIRE_BROWSER=1 nothing counts as skipped', { timeout: 120_000 }, t => {
  // Then every real browser file fails loudly; the throwaway file here does not ask for Chrome.
  const row = abschluss(t, { CHROME_BIN: '/gibt/es/nicht', REQUIRE_BROWSER: '1', REQUIRE_CADDY: '1' });
  assert.match(row, /übersprungen: 0 Browser-Dateien .*, 0 Caddy-Dateien/);
});

test('without SKIP_BROWSER=1 the files run with REQUIRE_BROWSER=1', { timeout: 120_000 }, t => {
  // With it helpers/app-browser throws instead of skipping; the throwaway file asserts the variable.
  const row = abschluss(
    t,
    { CHROME_BIN: '/gibt/es/nicht' },
    { browserBody: "require('node:assert').equal(process.env.REQUIRE_BROWSER, '1');" },
  );
  assert.match(row, /übersprungen: 0 Browser-Dateien/);
});
