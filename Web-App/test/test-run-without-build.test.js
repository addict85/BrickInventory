/**
 * A run inside a run does not rebuild: the tests of scripts/test-run.js
 * start it as a child while parallel files read migrations from dist/ and the
 * bundle; a rebuild there resulted in „Migration nachträglich geändert“.
 *
 * Counter-check (measured 06.11.2026): in main() the condition
 * `TEST_LAUF_GEBAUT !== '1'` removed → red: „dist/ und Bündel bleiben
 * unberührt“ (mtime of dist/server.js new).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

test('a run inside a run does not build', { timeout: 120_000 }, t => {
  require('./helpers/sources').buildAndRequire();
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'test-lauf-ohne-bau-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const output = path.join(ordner, 'marke.txt');
  const datei = path.join(ordner, 'marke.test.js');
  fs.writeFileSync(
    datei,
    `require('node:test')('marke', () => require('node:fs').writeFileSync(${JSON.stringify(output)}, String(process.env.TEST_LAUF_GEBAUT)));\n`,
  );
  const times = () =>
    ['dist/server.js', 'dist/db/migrations', 'public/js/app.bundle.js'].map(
      f => fs.statSync(path.join(ROOT, f)).mtimeMs,
    );
  const vorher = times();
  const env = { ...process.env, TEST_LAUF_GEBAUT: '1' };
  for (const k of ['TEST_DATABASE_URL', 'TEST_DB_VORLAGE', 'TEST_DB_BASIS', 'TEST_DB_EIGEN', 'NODE_TEST_CONTEXT'])
    delete env[k];
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'test-run.js'), datei], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: 100_000,
  });
  assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-2000));
  assert.deepEqual(times(), vorher, 'dist/ und Bündel bleiben unberührt');
  assert.equal(fs.readFileSync(output, 'utf8'), '1', 'die Kinder erben die Marke');
});
