/**
 * Secrets may come from files (Docker secrets): X_FILE instead of X for
 * SESSION_SECRET, PGPASSWORD, DATABASE_URL and ADMIN_PASSWORD. Without X_FILE
 * everything stays as before.
 *
 * Counter-checks (measured 03.11.2026, each on its own):
 *   A  secretsFromFiles() not called in ladeKonfig → red: “the
 *      session secret comes from the file” and “both set is an error”
 *   B  the trailing line break not removed → red: “the
 *      session secret …” and “the database password …”
 *   C  the call deleted in databaseConnection → red: “the
 *      database password comes from the file”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const { ladeKonfig, databaseConnection, KonfigFehler } = _req('src/infra/config.js');

const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'geheimnis-datei-'));
test.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
const datei = (name, inhalt) => {
  const p = path.join(ordner, name);
  fs.writeFileSync(p, inhalt, { mode: 0o600 });
  return p;
};

test('the session secret comes from the file', () => {
  const env = {
    SESSION_SECRET_FILE: datei('sitzung', 'aus-der-datei-lang-genug-fuer-den-start-42\n'),
    ADMIN_PASSWORD_FILE: datei('verwalter', 'Verwalter-aus-Datei-1'),
  };
  const k = ladeKonfig(env);
  assert.equal(k.sessionSecret, 'aus-der-datei-lang-genug-fuer-den-start-42');
  assert.equal(k.adminPassword, 'Verwalter-aus-Datei-1');
  assert.equal(env.SESSION_SECRET_FILE, undefined, 'X_FILE bleibt stehen, ein zweiter Lauf meldete „beide gesetzt"');
  assert.equal(ladeKonfig(env).sessionSecret, 'aus-der-datei-lang-genug-fuer-den-start-42');
});

test('the database password comes from the file', () => {
  const v = databaseConnection({ PGPASSWORD_FILE: datei('db', 'db-aus-datei\n'), PGUSER: 'brickinventory_app' });
  assert.equal(v.password, 'db-aus-datei');
  const url = databaseConnection({ DATABASE_URL_FILE: datei('url', 'postgres://a:b@c/d\n') });
  assert.equal(url.connectionString, 'postgres://a:b@c/d');
});

test('both set is an error, a missing file too', () => {
  assert.throws(
    () => ladeKonfig({ SESSION_SECRET: 'x'.repeat(40), SESSION_SECRET_FILE: datei('s2', 'y'.repeat(40)) }),
    (/** @type {any} */ e) =>
      e instanceof KonfigFehler && e.fehler.some(f => /SESSION_SECRET und SESSION_SECRET_FILE/.test(f)),
  );
  assert.throws(
    () => ladeKonfig({ PGPASSWORD_FILE: path.join(ordner, 'gibt-es-nicht') }),
    (/** @type {any} */ e) => e instanceof KonfigFehler && e.fehler.some(f => /PGPASSWORD_FILE=.*ENOENT/.test(f)),
  );
});

test('without X_FILE as before', () => {
  assert.equal(ladeKonfig({ SESSION_SECRET: 'wie-bisher' }).sessionSecret, 'wie-bisher');
});
