/**
 * Der Datenschlüssel liegt ausserhalb von data/: aus DATA_KEY_FILE, Vorgabe
 * <APP_ROOT>/schluessel/datenschluessel. Eine ältere Installation mit
 * data/.datenschluessel läuft weiter und bekommt beim Laden den Umzug
 * erklärt; zwei verschiedene Schlüssel halten den Start an. Jeder Fall läuft
 * in einem eigenen Prozess mit eigenem APP_ROOT.
 *
 * Gegenproben (01.11.2026 gemessen):
 *   A  schluesselDatei() ohne konfig().datenSchluesselDatei → rot: „der
 *      Schlüssel aus DATA_KEY_FILE …"
 *   B  Rückfall auf data/.datenschluessel entfernt → rot: „eine alte
 *      Installation …" (neuer Schlüssel, die alten Geheimnisse wären verloren)
 *   C  Vergleich der beiden Dateien entfernt → rot: „zwei verschiedene …"
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

/** Lädt den Schlüssel in einem frischen Prozess; liefert ihn base64 samt stderr. */
function lade(wurzel, env = {}) {
  const skript = `const g = require(${JSON.stringify(path.join(DIST, 'src/infra/geheimnis.js'))});
    process.stdout.write(g.datenSchluessel().toString('base64'));`;
  const r = spawnSync(process.execPath, ['-e', skript], { encoding: 'utf8',
    env: { ...process.env, DATA_KEY: '', DATA_KEY_FILE: '', APP_ROOT: wurzel, ...env } });
  return { schluessel: r.status === 0 ? r.stdout : null, fehler: r.stderr, status: r.status };
}

function installation(t) {
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'datenschluessel-'));
  t.after(() => fs.rmSync(wurzel, { recursive: true, force: true }));
  fs.mkdirSync(path.join(wurzel, 'data'));
  return wurzel;
}
const zufall = () => crypto.randomBytes(32).toString('base64');

test('der Schlüssel aus DATA_KEY_FILE wird benutzt, nichts landet in data/', (t) => {
  const wurzel = installation(t), datei = path.join(wurzel, 'geheim', 'k'), k = zufall();
  fs.mkdirSync(path.dirname(datei));
  fs.writeFileSync(datei, k + '\n', { mode: 0o600 });
  const r = lade(wurzel, { DATA_KEY_FILE: datei });
  assert.equal(r.schluessel, k, r.fehler);
  assert.doesNotMatch(r.fehler, /Datenordner/);
  assert.deepEqual(fs.readdirSync(path.join(wurzel, 'data')), []);
});

test('ohne Schlüssel entsteht er unter schluessel/, nur für den Besitzer lesbar', (t) => {
  const wurzel = installation(t);
  const r = lade(wurzel);
  const datei = path.join(wurzel, 'schluessel', 'datenschluessel');
  assert.equal(fs.readFileSync(datei, 'utf8'), r.schluessel);
  assert.equal(fs.statSync(datei).mode & 0o077, 0);
  assert.deepEqual(fs.readdirSync(path.join(wurzel, 'data')), []);
  assert.equal(lade(wurzel).schluessel, r.schluessel, 'der zweite Start nimmt denselben');
});

test('eine alte Installation mit data/.datenschluessel läuft weiter und wird gewarnt', (t) => {
  const wurzel = installation(t), alt = zufall();
  fs.writeFileSync(path.join(wurzel, 'data', '.datenschluessel'), alt, { mode: 0o600 });
  const neu = path.join(wurzel, 'schluessel', 'datenschluessel');
  const r = lade(wurzel, { DATA_KEY_FILE: neu });
  assert.equal(r.schluessel, alt, r.fehler);
  assert.match(r.fehler, /liegt im Datenordner .*verschieben.*UPGRADE\.md/s);
  assert.equal(fs.existsSync(neu), false, 'ein zweiter Schlüssel ist entstanden');
  // Nach dem Umzug: keine Warnung mehr.
  fs.mkdirSync(path.dirname(neu));
  fs.renameSync(path.join(wurzel, 'data', '.datenschluessel'), neu);
  const danach = lade(wurzel, { DATA_KEY_FILE: neu });
  assert.equal(danach.schluessel, alt);
  assert.doesNotMatch(danach.fehler, /Datenordner/);
});

test('zwei verschiedene Schlüssel halten den Start an', (t) => {
  const wurzel = installation(t);
  fs.writeFileSync(path.join(wurzel, 'data', '.datenschluessel'), zufall());
  fs.mkdirSync(path.join(wurzel, 'schluessel'));
  fs.writeFileSync(path.join(wurzel, 'schluessel', 'datenschluessel'), zufall());
  const r = lade(wurzel);
  assert.equal(r.schluessel, null);
  assert.match(r.fehler, /Zwei verschiedene Datenschlüssel/);
});
