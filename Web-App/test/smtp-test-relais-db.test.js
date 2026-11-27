/**
 * The SMTP test is not a mail relay: at most 10 per hour and account. Any address
 * needs only the administrator login, no password (docs/SICHERHEIT.md).
 *
 * Counter-checks (measured on 07.11.2026, each on its own):
 *   A  (26.11.2026) a password check back into /smtp-test → red: “a
 *      foreign address needs no password either” (400 instead of 200)
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
const sent = [];
require('./helpers/sources').replaceServices('mail', {
  sendSmtpTest: async to => {
    sent.push(to);
    return { success: true, mode: 'console' };
  },
});
const { routerServer } = require('./helpers/server');
const { dataOrSkip } = require('./helpers/db');
const db = S.testData();
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

const NAME = `smtprelais_${process.pid}`,
  PASS = 'chef-Passwort-1';

test('SMTP test with the login, throttled', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const owned = `${NAME}@example.org`;
  const uid = (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $3, $2, true, true, true) RETURNING id`,
      [NAME, bcrypt.hashSync(PASS, 4), owned],
    )
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', [`%|konto:${uid}%`]);
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  const { base } = routerServer(_req, {
    session: { userId: uid, isAdmin: true },
    routes: { '/api/v2': 'routes/api/settings.js' },
    t,
  });
  const probe = body =>
    fetch(`${base}/api/v2/settings/smtp-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async r => ({ status: r.status, body: await r.json() }));

  await t.test('the own address needs no password', async () => {
    const r = await probe({});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const r2 = await probe({ to: owned.toUpperCase() });
    assert.equal(r2.status, 200, JSON.stringify(r2.body));
    assert.deepEqual(sent, [owned, owned.toUpperCase()]);
  });

  await t.test('a foreign address needs no password either', async () => {
    sent.length = 0;
    const ok = await probe({ to: 'fremd@example.net' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(sent, ['fremd@example.net']);
  });

  await t.test('from the eleventh mail in an hour it stops', async () => {
    let last;
    for (let i = 0; i < 12; i++) {
      last = await probe({});
      if (last.status === 429) break;
    }
    assert.equal(last.status, 429, JSON.stringify(last.body));
  });
});
