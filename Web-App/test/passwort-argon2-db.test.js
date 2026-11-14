/**
 * Passwörter als argon2id (src/konto/passwortHash.ts): Neue Hashes sind argon2id, ein
 * bcrypt-Hash aus der Zeit davor gilt weiter und wird bei der ersten erfolgreichen
 * Anmeldung ersetzt, nicht bei einer gescheiterten. Über die echte Route /login und die
 * Laufzeitrolle (der Hash wird im Systemrahmen gelesen und geschrieben).
 *
 * Gegenproben (14.11.2026 gemessen, je einzeln):
 *   A  in pruefeAnmeldedaten das Ersetzen nach brauchtNeuenHash gestrichen → rot:
 *      „ein bcrypt-Hash wird bei der Anmeldung ersetzt“ ($2b$04$ bleibt)
 *   B  das Ersetzen vor die Passwortprüfung gezogen (auch bei Fehlversuch) → rot:
 *      „… ein Fehlversuch ersetzt nichts“ (der Hash hiess danach argon2id)
 *   C  ersetzePasswortHash aus der Systemliste in src/konto/kontext.ts gestrichen →
 *      rot: „ein bcrypt-Hash …“ (permission denied for table users, 500)
 *   D  passwortPasst prüft nur noch bcrypt → rot: „neue Hashes sind argon2id …“ und
 *      „… danach mit argon2id“ (die zweite Anmeldung 401)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.APP_BASE_URL = 'http://localhost';
const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testDaten();
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));
const { ARGON2_PRAEFIX, hashePasswort, passwortPasst } = _req('src/konto/passwortHash.js');

test('argon2id und das Ersetzen alter bcrypt-Hashes', { concurrency: 1, timeout: 60_000 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
  const NAME = `argon_${process.pid}`,
    PASS = 'Argon-Pruefung-2026-ä';
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified) VALUES ($1, $2, true, true) RETURNING id`,
      [NAME, await bcrypt.hash(PASS, 4)],
    )
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  const { base } = testServer(_req, { t });
  const anmelden = async passwort =>
    (
      await fetch(`${base}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: NAME, password: passwort, ohne_token: true }),
      })
    ).status;
  const gespeichert = async () => (await db.get('SELECT password_hash FROM users WHERE id = $1', [uid])).password_hash;

  await t.test('neue Hashes sind argon2id mit den festen Kosten', async () => {
    const h = await hashePasswort(PASS);
    assert.ok(h.startsWith(ARGON2_PRAEFIX), h.slice(0, 40));
    assert.equal(await passwortPasst(PASS, h), true);
    assert.equal(await passwortPasst(`${PASS}x`, h), false);
    // Was hinter Byte 72 steht, zählt (bcrypt schnitt es ab).
    const lang = 'L'.repeat(80);
    assert.equal(await passwortPasst(`${lang}b`, await hashePasswort(`${lang}a`)), false);
  });

  await t.test('… ein Fehlversuch ersetzt nichts', async () => {
    assert.equal(await anmelden('falsches-Passwort-1'), 401);
    assert.match(await gespeichert(), /^\$2[aby]\$04\$/);
  });

  await t.test('ein bcrypt-Hash wird bei der Anmeldung ersetzt, danach mit argon2id', async () => {
    assert.equal(await anmelden(PASS), 200);
    const neu = await gespeichert();
    assert.ok(neu.startsWith(ARGON2_PRAEFIX), neu.slice(0, 40));
    assert.equal(await anmelden(PASS), 200);
    assert.equal(await gespeichert(), neu, 'ein aktueller Hash bleibt stehen');
  });
});
