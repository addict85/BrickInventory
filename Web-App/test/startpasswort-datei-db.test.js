/**
 * Das zufällige Startpasswort des ersten Verwalters steht nicht im Log, sondern
 * in einer Datei mit 0600 im Datenverzeichnis; das Log nennt nur den Pfad. Mit
 * dem ersten eigenen Passwortwechsel verschwindet die Datei.
 *
 * Gegenproben (09.11.2026 gemessen, je einzeln):
 *   A  in legeStartVerwalterAn() (src/konto/startVerwalter.ts) zusätzlich das Passwort per
 *      console.log ausgegeben → rot: „das Log nennt den Pfad, nicht das Passwort“
 *   B  in schreibeStartpasswort() `mode: 0o644` → rot: „nur der Dienst kann sie lesen“
 *   C  in aendereEigenesPasswort() (src/konto/konten.ts) startpasswortErledigt()
 *      gestrichen → rot: „der erste Passwortwechsel löscht die Datei“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL (das Schema wird neu angelegt).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
delete process.env.ADMIN_PASSWORD;
const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'startpasswort-'));
process.env.APP_ROOT = wurzel;

const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const db = testDaten();
const { keineDb } = require('./helpers/db');
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

test('Startpasswort in einer Datei statt im Log', async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    keineDb(t, e);
    return;
  }
  t.after(async () => {
    await db.pool.end().catch(() => {});
    fs.rmSync(wurzel, { recursive: true, force: true });
  });
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  const ausgabe = [];
  const echt = { log: console.log, warn: console.warn, schreib: process.stdout.write };
  console.log = console.warn = (...a) => {
    ausgabe.push(a.join(' '));
  };
  process.stdout.write = s => {
    ausgabe.push(String(s));
    return true;
  };
  try {
    await db.initSchema();
  } finally {
    console.log = echt.log;
    console.warn = echt.warn;
    process.stdout.write = echt.schreib;
  }

  const datei = path.join(wurzel, 'data', 'admin-startpasswort.txt');
  const [name, passwort] = fs.readFileSync(datei, 'utf8').split('\n');
  const admin = await db.get("SELECT id, password_hash, must_change_password FROM users WHERE username = 'admin'");

  await t.test('die Datei trägt das Passwort des Kontos', () => {
    assert.equal(name, 'admin');
    assert.ok(bcrypt.compareSync(passwort, admin.password_hash));
    assert.equal(admin.must_change_password, true);
  });
  await t.test('nur der Dienst kann sie lesen', () => {
    assert.equal(fs.statSync(datei).mode & 0o777, 0o600);
  });
  await t.test('das Log nennt den Pfad, nicht das Passwort', () => {
    const log = ausgabe.join('\n');
    assert.ok(log.includes(datei), log);
    assert.ok(!log.includes(passwort), 'Passwort im Log');
  });
  await t.test('der erste Passwortwechsel löscht die Datei', async () => {
    await _req('src/konto/konten.js').aendereEigenesPasswort(admin.id, 'ein-neues-langes-Passwort-42');
    assert.equal(fs.existsSync(datei), false);
  });
});
