/**
 * Das beim ersten Start angelegte Verwalterkonto hat dieselben Hash-Kosten
 * wie jedes andere Passwort. Mit weniger antwortete ein Fehlversuch gegen
 * „admin“ messbar schneller als gegen einen unbekannten Namen.
 *
 * Gegenprobe (am 28.10.2026 gemessen; seit 09.11. in src/konto/startVerwalter.ts): wieder
 * `hashSync(plainPassword, 10)` → rot (10 statt 12).
 * Gegenprobe (14.11.2026, argon2id): in hashePasswortSofort `timeCost: 1` → rot
 * (Präfix mit t=1 statt t=2).
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL (das Schema wird neu angelegt).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
delete process.env.ADMIN_PASSWORD;

const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testDaten();

test('Verwalterkonto mit derselben Rundenzahl', async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    keineDb(t, e);
    return;
  }
  t.after(() => db.pool.end().catch(() => {}));
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  const echt = console.log;
  console.log = () => {};
  try {
    await db.initSchema();
  } finally {
    console.log = echt;
  }
  const admin = await db.get("SELECT password_hash FROM users WHERE username = 'admin'");
  assert.ok(admin, 'kein Verwalterkonto angelegt');
  const { ARGON2_PRAEFIX } = _req('src/konto/passwortHash.js');
  assert.ok(admin.password_hash.startsWith(ARGON2_PRAEFIX), admin.password_hash.slice(0, 40));
});
