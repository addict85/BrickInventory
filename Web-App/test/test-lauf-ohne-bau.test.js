/**
 * Ein Lauf innerhalb eines Laufs baut nicht neu: Die Tests von scripts/test-lauf.js
 * starten ihn als Kind, während parallele Dateien Migrationen aus dist/ und das
 * Bündel lesen; ein Neubau dort ergab „Migration nachträglich geändert“.
 *
 * Gegenprobe (06.11.2026 gemessen): in main() die Bedingung
 * `TEST_LAUF_GEBAUT !== '1'` entfernt → rot: „dist/ und Bündel bleiben
 * unberührt“ (mtime von dist/server.js neu).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

test('ein Lauf im Lauf baut nicht', { timeout: 120_000 }, t => {
  require('./helpers/sources').buildAndRequire();
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'test-lauf-ohne-bau-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const ausgabe = path.join(ordner, 'marke.txt');
  const datei = path.join(ordner, 'marke.test.js');
  fs.writeFileSync(
    datei,
    `require('node:test')('marke', () => require('node:fs').writeFileSync(${JSON.stringify(ausgabe)}, String(process.env.TEST_LAUF_GEBAUT)));\n`,
  );
  const zeiten = () =>
    ['dist/server.js', 'dist/db/migrations', 'public/js/app.bundle.js'].map(
      f => fs.statSync(path.join(ROOT, f)).mtimeMs,
    );
  const vorher = zeiten();
  const env = { ...process.env, TEST_LAUF_GEBAUT: '1' };
  for (const k of ['TEST_DATABASE_URL', 'TEST_DB_VORLAGE', 'TEST_DB_BASIS', 'TEST_DB_EIGEN', 'NODE_TEST_CONTEXT'])
    delete env[k];
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'test-lauf.js'), datei], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: 100_000,
  });
  assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-2000));
  assert.deepEqual(zeiten(), vorher, 'dist/ und Bündel bleiben unberührt');
  assert.equal(fs.readFileSync(ausgabe, 'utf8'), '1', 'die Kinder erben die Marke');
});
