/**
 * scripts/coverage.js: from real V8 files an lcov report with
 * scopes is created, and the thresholds turn a decline red.
 *
 * Counter-checks (05.11.2026, each alone):
 *   A  filter in report() no longer lets dist/ through → “a run over
 *      dist/ …” red (server 0 %)
 *   B  in check() `ist[k] < s - 100` instead of `!(ist[k] >= s)` → “below the threshold
 *      is red …” red
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildDist } = require('./helpers/sources');
const { report, check } = require('../scripts/coverage');

const ROOT = path.join(__dirname, '..');

test('a run over dist/ yields lcov and areas', async () => {
  buildDist();
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'abdeckung-'));
  try {
    const v8 = path.join(ordner, 'v8');
    // A small real run: load a module from dist/ and call a function.
    const r = spawnSync(
      process.execPath,
      ['-e', "const f = require('./dist/src/infra/errorTexts.js'); console.log(typeof f)"],
      { cwd: ROOT, env: { ...process.env, NODE_V8_COVERAGE: v8 }, encoding: 'utf8' },
    );
    assert.equal(r.status, 0, r.stderr);
    const areaList = await report(v8, ordner);
    assert.ok(areaList.server > 0, JSON.stringify(areaList));
    assert.equal(areaList.ui, 0);
    const lcov = fs.readFileSync(path.join(ordner, 'lcov.info'), 'utf8');
    assert.match(lcov, /^SF:.*dist\/src\/infra\/errorTexts\.js$/m);
    assert.doesNotMatch(lcov, /node_modules/);
  } finally {
    fs.rmSync(ordner, { recursive: true, force: true });
  }
});

test('below the limit is red, above it is not', () => {
  const datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'schranke-')), 's.json');
  fs.writeFileSync(datei, JSON.stringify({ total: 80, ui: 50 }));
  assert.deepEqual(check({ total: 85, ui: 50 }, datei), []);
  assert.deepEqual(check({ total: 79.9, ui: 60 }, datei), ['total: 79.9 % < 80 %']);
  assert.deepEqual(check({ total: 90 }, datei), ['ui: undefined % < 50 %']);
});
