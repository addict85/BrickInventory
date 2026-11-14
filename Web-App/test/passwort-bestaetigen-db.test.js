/**
 * Das aktuelle Passwort in einer laufenden Sitzung: gebremst je Konto und Zugang,
 * Token kann sich nicht selbst vermehren.
 *
 * Wer ein Token erbeutet hat, konnte über /change-password, PUT /profile und
 * den zweiten Faktor das Passwort unbegrenzt raten und über /token-create
 * beliebig viele dauerhafte Tokens nachprägen.
 *
 * Gegenproben (am 27.10. gemessen):
 *   A  in bestaetigePasswort() die Sperrabfrage entfernt → rot: „nach fünf
 *      Fehlversuchen ist Schluss"
 *   B  in token-create die Sitzungsbedingung entfernt → rot: „ein Token prägt
 *      keinen weiteren"
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const AUTH = require('./helpers/sources').einhaengung('auth');
const db = testDaten();
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const NAME = `pwbest_${process.pid}`,
  PASS = 'Passwort12345';

test('Passwort bestätigen', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified)
     VALUES ($1, $2, $3, true, true) RETURNING id`,
      [NAME, `${NAME}@example.org`, await bcrypt.hash(PASS, 4)],
    )
  ).id;
  await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE $1`, [`passwort-bestaetigen|${uid}|%`]);
  t.after(async () => {
    await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE $1`, [`%-bestaetigen|${uid}|%`]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const mitSitzung = testServer(_req, { sitzung: { userId: uid, username: NAME }, t });
  const ohneSitzung = testServer(_req, { sitzung: {}, t });
  const post = async (srv, pfad, body, kopf = {}) => {
    const r = await fetch(`${srv.base}${AUTH}${pfad}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...kopf },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };

  await t.test('ein Token prägt keinen weiteren', async () => {
    const token = await _req('src/konto/geraeteToken.js').tokenAnlegen(uid, 'Probe');
    const r = await post(ohneSitzung, '/token-create', { password: PASS }, { Authorization: `Bearer ${token}` });
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.equal(r.body.code, 'nur_mit_sitzung');
  });

  await t.test('aus der Sitzung nur mit dem Passwort', async () => {
    assert.equal((await post(mitSitzung, '/token-create', {})).status, 400);
    const r = await post(mitSitzung, '/token-create', { password: PASS });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.token);
  });

  await t.test('nach fünf Fehlversuchen ist Schluss — auch mit dem richtigen Passwort', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await post(mitSitzung, '/change-password', { current: 'falsch' + i, newPassword: 'NeuesPasswort123' });
      assert.equal(r.status, 400, `Versuch ${i + 1}`);
    }
    const r = await post(mitSitzung, '/change-password', { current: PASS, newPassword: 'NeuesPasswort123' });
    assert.equal(r.status, 429, JSON.stringify(r.body));
    // Dieselbe Bremse gilt für den zweiten Faktor.
    assert.equal((await post(mitSitzung, '/zweiter-faktor/einrichten', { password: PASS })).status, 429);
  });

  await t.test('ein Erfolg setzt den Zähler zurück', async () => {
    await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE $1`, [`passwort-bestaetigen|${uid}|%`]);
    for (let i = 0; i < 4; i++) await post(mitSitzung, '/zweiter-faktor/einrichten', { password: 'falsch' });
    assert.equal((await post(mitSitzung, '/zweiter-faktor/einrichten', { password: PASS })).status, 200);
    assert.equal(
      (await post(mitSitzung, '/zweiter-faktor/einrichten', { password: 'falsch' })).status,
      400,
      'nach dem Erfolg zählt wieder von vorn',
    );
  });
});
