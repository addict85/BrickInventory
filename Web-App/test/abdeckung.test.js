/**
 * scripts/abdeckung.js: aus echten V8-Dateien entsteht ein lcov-Bericht mit
 * Bereichen, und die Schranken machen einen Rückgang rot.
 *
 * Gegenproben (05.11.2026, je einzeln):
 *   A  Filter in bericht() lässt dist/ nicht mehr durch → „ein Lauf über
 *      dist/ …“ rot (server 0 %)
 *   B  in pruefen() `ist[k] < s - 100` statt `!(ist[k] >= s)` → „unter der Schranke
 *      ist rot …“ rot
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { baueDist } = require('./helpers/sources');
const { bericht, pruefen } = require('../scripts/abdeckung');

const ROOT = path.join(__dirname, '..');

test('ein Lauf über dist/ ergibt lcov und Bereiche', async () => {
  baueDist();
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'abdeckung-'));
  try {
    const v8 = path.join(ordner, 'v8');
    // Ein kleiner echter Lauf: ein Modul aus dist/ laden und eine Funktion aufrufen.
    const r = spawnSync(
      process.execPath,
      ['-e', "const f = require('./dist/src/infra/fehlerTexte.js'); console.log(typeof f)"],
      { cwd: ROOT, env: { ...process.env, NODE_V8_COVERAGE: v8 }, encoding: 'utf8' },
    );
    assert.equal(r.status, 0, r.stderr);
    const bereiche = await bericht(v8, ordner);
    assert.ok(bereiche.server > 0, JSON.stringify(bereiche));
    assert.equal(bereiche.oberflaeche, 0);
    const lcov = fs.readFileSync(path.join(ordner, 'lcov.info'), 'utf8');
    assert.match(lcov, /^SF:.*dist\/src\/infra\/fehlerTexte\.js$/m);
    assert.doesNotMatch(lcov, /node_modules/);
  } finally {
    fs.rmSync(ordner, { recursive: true, force: true });
  }
});

test('unter der Schranke ist rot, darüber nicht', () => {
  const datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'schranke-')), 's.json');
  fs.writeFileSync(datei, JSON.stringify({ gesamt: 80, oberflaeche: 50 }));
  assert.deepEqual(pruefen({ gesamt: 85, oberflaeche: 50 }, datei), []);
  assert.deepEqual(pruefen({ gesamt: 79.9, oberflaeche: 60 }, datei), ['gesamt: 79.9 % < 80 %']);
  assert.deepEqual(pruefen({ gesamt: 90 }, datei), ['oberflaeche: undefined % < 50 %']);
});
