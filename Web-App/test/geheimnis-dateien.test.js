/**
 * Geheimnisse dürfen aus Dateien kommen (Docker-Secrets): X_FILE statt X für
 * SESSION_SECRET, PGPASSWORD, DATABASE_URL und ADMIN_PASSWORD. Ohne X_FILE
 * bleibt alles wie bisher.
 *
 * Gegenproben (03.11.2026 gemessen, je einzeln):
 *   A  in ladeKonfig geheimnisseAusDateien() nicht aufgerufen → rot: „das
 *      Sitzungsgeheimnis kommt aus der Datei" und „beide gesetzt ist ein Fehler"
 *   B  den abschliessenden Zeilenumbruch nicht entfernt → rot: „das
 *      Sitzungsgeheimnis …" und „das Datenbankpasswort …"
 *   C  in datenbankVerbindung den Aufruf gestrichen → rot: „das
 *      Datenbankpasswort kommt aus der Datei"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const { ladeKonfig, datenbankVerbindung, KonfigFehler } = _req('src/infra/konfig.js');

const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'geheimnis-datei-'));
test.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
const datei = (name, inhalt) => {
  const p = path.join(ordner, name);
  fs.writeFileSync(p, inhalt, { mode: 0o600 });
  return p;
};

test('das Sitzungsgeheimnis kommt aus der Datei', () => {
  const env = {
    SESSION_SECRET_FILE: datei('sitzung', 'aus-der-datei-lang-genug-fuer-den-start-42\n'),
    ADMIN_PASSWORD_FILE: datei('verwalter', 'Verwalter-aus-Datei-1'),
  };
  const k = ladeKonfig(env);
  assert.equal(k.sessionSecret, 'aus-der-datei-lang-genug-fuer-den-start-42');
  assert.equal(k.adminPasswort, 'Verwalter-aus-Datei-1');
  assert.equal(env.SESSION_SECRET_FILE, undefined, 'X_FILE bleibt stehen, ein zweiter Lauf meldete „beide gesetzt"');
  assert.equal(ladeKonfig(env).sessionSecret, 'aus-der-datei-lang-genug-fuer-den-start-42');
});

test('das Datenbankpasswort kommt aus der Datei', () => {
  const v = datenbankVerbindung({ PGPASSWORD_FILE: datei('db', 'db-aus-datei\n'), PGUSER: 'brickinventory_app' });
  assert.equal(v.password, 'db-aus-datei');
  const url = datenbankVerbindung({ DATABASE_URL_FILE: datei('url', 'postgres://a:b@c/d\n') });
  assert.equal(url.connectionString, 'postgres://a:b@c/d');
});

test('beide gesetzt ist ein Fehler, eine fehlende Datei auch', () => {
  assert.throws(
    () => ladeKonfig({ SESSION_SECRET: 'x'.repeat(40), SESSION_SECRET_FILE: datei('s2', 'y'.repeat(40)) }),
    e => e instanceof KonfigFehler && e.fehler.some(f => /SESSION_SECRET und SESSION_SECRET_FILE/.test(f)),
  );
  assert.throws(
    () => ladeKonfig({ PGPASSWORD_FILE: path.join(ordner, 'gibt-es-nicht') }),
    e => e instanceof KonfigFehler && e.fehler.some(f => /PGPASSWORD_FILE=.*ENOENT/.test(f)),
  );
});

test('ohne X_FILE wie bisher', () => {
  assert.equal(ladeKonfig({ SESSION_SECRET: 'wie-bisher' }).sessionSecret, 'wie-bisher');
});
