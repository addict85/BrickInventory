/**
 * Der SMTP-Test ist kein Mail-Relais: an die eigene Adresse des Verwalters
 * geht er ohne Rückfrage (höchstens 10 je Stunde), an jede andere nur mit
 * Passwort — wie das Ändern des Mailservers.
 *
 * Gegenproben (am 07.11.2026 gemessen, je einzeln):
 *   A  die Passwortprüfung für fremde Adressen entfernt → rot: „eine fremde
 *      Adresse braucht das Passwort“ (200 statt 400, Mail ging raus)
 *   B  die Drossel entfernt → rot: „ab der elften Mail in der Stunde
 *      Schluss“ (200 statt 429)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const gesendet = [];
const echterMailer = _req('src/mail/mailer.js');
require.cache[require.resolve(path.join(S.DIST, 'src/mail/mailer.js'))].exports = Object.assign({}, echterMailer, {
  testSmtp: async () => ({ success: true }),
  sendMail: async m => {
    gesendet.push(m.to);
    return { success: true, mode: 'console' };
  },
});
const { testServer } = require('./helpers/server');
const { datenOderSkip } = require('./helpers/db');
const db = S.testDaten();
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

const NAME = `smtprelais_${process.pid}`,
  PASS = 'chef-Passwort-1';

test('SMTP-Test nur an die eigene Adresse oder mit Passwort', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const eigene = `${NAME}@example.org`;
  const uid = (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $3, $2, true, true, true) RETURNING id`,
      [NAME, bcrypt.hashSync(PASS, 4), eigene],
    )
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', [`%|konto:${uid}%`]);
    await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', [`%-bestaetigen|${uid}|%`]);
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  const { base } = testServer(_req, {
    sitzung: { userId: uid, isAdmin: true },
    routen: { '/api/v1': 'routes/api_v1/settings.js' },
    t,
  });
  const probe = body =>
    fetch(`${base}/api/v1/settings/smtp-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async r => ({ status: r.status, body: await r.json() }));

  await t.test('die eigene Adresse braucht kein Passwort', async () => {
    const r = await probe({});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const r2 = await probe({ to: eigene.toUpperCase() });
    assert.equal(r2.status, 200, JSON.stringify(r2.body));
    assert.deepEqual(gesendet, [eigene, eigene.toUpperCase()]);
  });

  await t.test('eine fremde Adresse braucht das Passwort', async () => {
    gesendet.length = 0;
    const r = await probe({ to: 'fremd@example.net' });
    assert.deepEqual([r.status, r.body.code], [400, 'aktuelles_passwort_falsch']);
    assert.deepEqual(gesendet, []);
    const falsch = await probe({ to: 'fremd@example.net', password: 'falsch' });
    assert.equal(falsch.status, 400);
    assert.deepEqual(gesendet, []);
    const ok = await probe({ to: 'fremd@example.net', password: PASS });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(gesendet, ['fremd@example.net']);
  });

  await t.test('ab der elften Mail in der Stunde Schluss', async () => {
    let letzte;
    for (let i = 0; i < 12; i++) {
      letzte = await probe({});
      if (letzte.status === 429) break;
    }
    assert.equal(letzte.status, 429, JSON.stringify(letzte.body));
  });
});
