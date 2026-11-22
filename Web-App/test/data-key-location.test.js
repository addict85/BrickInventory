/**
 * The data key lives outside data/: from DATA_KEY_FILE, default
 * <APP_ROOT>/schluessel/datenschluessel. An older installation with
 * data/.datenschluessel keeps running and gets the move explained
 * on loading; two different keys stop the start. Every case runs
 * in its own process with its own APP_ROOT.
 *
 * Counter-checks (measured 01.11.2026):
 *   A  keyFile() without konfig().dataKeyFile → red: “the
 *      key from DATA_KEY_FILE …"
 *   B  fallback to data/.datenschluessel removed → red: “an old
 *      installation …" (new key, the old secrets would be lost)
 *   C  comparison of the two files removed → red: “two different …"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DIST } = require('./helpers/sources');
require('./helpers/sources').buildAndRequire();

/** Loads the key in a fresh process; returns it base64 together with stderr. */
function lade(wurzel, env = {}) {
  const script = `const g = require(${JSON.stringify(path.join(DIST, 'src/infra/secret.js'))});
    process.stdout.write(g.datenSchluessel().toString('base64'));`;
  const r = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, DATA_KEY: '', DATA_KEY_FILE: '', APP_ROOT: wurzel, ...env },
  });
  return { schluessel: r.status === 0 ? r.stdout : null, fehler: r.stderr, status: r.status };
}

function installation(t) {
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'datenschluessel-'));
  t.after(() => fs.rmSync(wurzel, { recursive: true, force: true }));
  fs.mkdirSync(path.join(wurzel, 'data'));
  return wurzel;
}
const zufall = () => crypto.randomBytes(32).toString('base64');

test('the key from DATA_KEY_FILE is used, nothing ends up in data/', t => {
  const wurzel = installation(t),
    datei = path.join(wurzel, 'geheim', 'k'),
    k = zufall();
  fs.mkdirSync(path.dirname(datei));
  fs.writeFileSync(datei, k + '\n', { mode: 0o600 });
  const r = lade(wurzel, { DATA_KEY_FILE: datei });
  assert.equal(r.schluessel, k, r.fehler);
  assert.doesNotMatch(r.fehler, /Datenordner/);
  assert.deepEqual(fs.readdirSync(path.join(wurzel, 'data')), []);
});

test('without a key it is created under schluessel/, readable only by the owner', t => {
  const wurzel = installation(t);
  const r = lade(wurzel);
  const datei = path.join(wurzel, 'schluessel', 'datenschluessel');
  assert.equal(fs.readFileSync(datei, 'utf8'), r.schluessel);
  assert.equal(fs.statSync(datei).mode & 0o077, 0);
  assert.deepEqual(fs.readdirSync(path.join(wurzel, 'data')), []);
  assert.equal(lade(wurzel).schluessel, r.schluessel, 'der zweite Start nimmt denselben');
});

test('an old installation with data/.datenschluessel keeps running and is warned', t => {
  const wurzel = installation(t),
    alt = zufall();
  fs.writeFileSync(path.join(wurzel, 'data', '.datenschluessel'), alt, { mode: 0o600 });
  const neu = path.join(wurzel, 'schluessel', 'datenschluessel');
  const r = lade(wurzel, { DATA_KEY_FILE: neu });
  assert.equal(r.schluessel, alt, r.fehler);
  assert.match(r.fehler, /liegt im Datenordner .*verschieben.*UPGRADE\.md/s);
  assert.equal(fs.existsSync(neu), false, 'ein zweiter Schlüssel ist entstanden');
  // After the move: no more warning.
  fs.mkdirSync(path.dirname(neu));
  fs.renameSync(path.join(wurzel, 'data', '.datenschluessel'), neu);
  const danach = lade(wurzel, { DATA_KEY_FILE: neu });
  assert.equal(danach.schluessel, alt);
  assert.doesNotMatch(danach.fehler, /Datenordner/);
});

test('two different keys stop the startup', t => {
  const wurzel = installation(t);
  fs.writeFileSync(path.join(wurzel, 'data', '.datenschluessel'), zufall());
  fs.mkdirSync(path.join(wurzel, 'schluessel'));
  fs.writeFileSync(path.join(wurzel, 'schluessel', 'datenschluessel'), zufall());
  const r = lade(wurzel);
  assert.equal(r.schluessel, null);
  assert.match(r.fehler, /Zwei verschiedene Datenschlüssel/);
});
