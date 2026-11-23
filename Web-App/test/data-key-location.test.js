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
function load(root, env = {}) {
  const script = `const g = require(${JSON.stringify(path.join(DIST, 'src/infra/secret.js'))});
    process.stdout.write(g.dataKey().toString('base64'));`;
  const r = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, DATA_KEY: '', DATA_KEY_FILE: '', APP_ROOT: root, ...env },
  });
  return { key: r.status === 0 ? r.stdout : null, error: r.stderr, status: r.status };
}

function installation(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'datenschluessel-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'data'));
  return root;
}
const randomValue = () => crypto.randomBytes(32).toString('base64');

test('the key from DATA_KEY_FILE is used, nothing ends up in data/', t => {
  const root = installation(t),
    file = path.join(root, 'geheim', 'k'),
    k = randomValue();
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, k + '\n', { mode: 0o600 });
  const r = load(root, { DATA_KEY_FILE: file });
  assert.equal(r.key, k, r.error);
  assert.doesNotMatch(r.error, /Datenordner/);
  assert.deepEqual(fs.readdirSync(path.join(root, 'data')), []);
});

test('without a key it is created under schluessel/, readable only by the owner', t => {
  const root = installation(t);
  const r = load(root);
  const file = path.join(root, 'schluessel', 'datenschluessel');
  assert.equal(fs.readFileSync(file, 'utf8'), r.key);
  assert.equal(fs.statSync(file).mode & 0o077, 0);
  assert.deepEqual(fs.readdirSync(path.join(root, 'data')), []);
  assert.equal(load(root).key, r.key, 'the second start takes the same one');
});

test('an old installation with data/.datenschluessel keeps running and is warned', t => {
  const root = installation(t),
    alt = randomValue();
  fs.writeFileSync(path.join(root, 'data', '.datenschluessel'), alt, { mode: 0o600 });
  const fresh = path.join(root, 'schluessel', 'datenschluessel');
  const r = load(root, { DATA_KEY_FILE: fresh });
  assert.equal(r.key, alt, r.error);
  assert.match(r.error, /liegt im Datenordner .*verschieben.*UPGRADE\.md/s);
  assert.equal(fs.existsSync(fresh), false, 'a second key was created');
  // After the move: no more warning.
  fs.mkdirSync(path.dirname(fresh));
  fs.renameSync(path.join(root, 'data', '.datenschluessel'), fresh);
  const afterwards = load(root, { DATA_KEY_FILE: fresh });
  assert.equal(afterwards.key, alt);
  assert.doesNotMatch(afterwards.error, /Datenordner/);
});

test('two different keys stop the startup', t => {
  const root = installation(t);
  fs.writeFileSync(path.join(root, 'data', '.datenschluessel'), randomValue());
  fs.mkdirSync(path.join(root, 'schluessel'));
  fs.writeFileSync(path.join(root, 'schluessel', 'datenschluessel'), randomValue());
  const r = load(root);
  assert.equal(r.key, null);
  assert.match(r.error, /Zwei verschiedene Datenschlüssel/);
});
