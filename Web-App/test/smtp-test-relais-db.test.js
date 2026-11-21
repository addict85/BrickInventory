/**
 * The SMTP test is not a mail relay: to the admin's own address
 * it goes without a prompt (at most 10 per hour), to any other only with
 * password — like changing the mail server.
 *
 * Counter-checks (measured on 07.11.2026, each on its own):
 *   A  the password check for foreign addresses removed → red: “a foreign
 *      address needs the password” (200 instead of 400, mail went out)
 *   B  the throttle removed → red: “from the eleventh mail in an hour
 *      it stops” (200 instead of 429)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const gesendet = [];
require('./helpers/sources').replaceServices('mail', {
  sendSmtpTest: async to => {
    gesendet.push(to);
    return { success: true, mode: 'console' };
  },
});
const { routerServer } = require('./helpers/server');
const { dataOrSkip } = require('./helpers/db');
const db = S.testData();
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

const NAME = `smtprelais_${process.pid}`,
  PASS = 'chef-Passwort-1';

test('SMTP test only to the own address or with password', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
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
  const { base } = routerServer(_req, {
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

  await t.test('the own address needs no password', async () => {
    const r = await probe({});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const r2 = await probe({ to: eigene.toUpperCase() });
    assert.equal(r2.status, 200, JSON.stringify(r2.body));
    assert.deepEqual(gesendet, [eigene, eigene.toUpperCase()]);
  });

  await t.test('a foreign address needs the password', async () => {
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

  await t.test('from the eleventh mail in an hour it stops', async () => {
    let letzte;
    for (let i = 0; i < 12; i++) {
      letzte = await probe({});
      if (letzte.status === 429) break;
    }
    assert.equal(letzte.status, 429, JSON.stringify(letzte.body));
  });
});
