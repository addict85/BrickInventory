/**
 * The current password in a running session: throttled per account and access,
 * a token cannot multiply itself.
 *
 * Whoever had captured a token could guess the password without limit via
 * /change-password, PUT /profile and the second factor, and mint any number
 * of permanent tokens via /token-create.
 *
 * Counter-checks (measured on 27.10.):
 *   A  the lock query removed in bestaetigePasswort() → red: “after five
 *      failed attempts it stops”
 *   B  the session condition removed in token-create → red: “a token mints
 *      no further one”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const AUTH = require('./helpers/sources').mounting('auth');
const db = testData();
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const NAME = `pwbest_${process.pid}`,
  PASS = 'Passwort12345';

test('confirm password', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

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

  const withSession = testServer(_req, { session: { userId: uid, username: NAME }, t });
  const withoutSession = testServer(_req, { session: {}, t });
  const post = async (srv, path, body, head = {}) => {
    const r = await fetch(`${srv.base}${AUTH}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...head },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };

  await t.test('a token mints no further one', async () => {
    const token = await _req('src/account/deviceToken.js').createToken(uid, 'Probe');
    const r = await post(withoutSession, '/token-create', { password: PASS }, { Authorization: `Bearer ${token}` });
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.equal(r.body.code, 'session_only');
  });

  await t.test('from the session only with the password', async () => {
    assert.equal((await post(withSession, '/token-create', {})).status, 400);
    const r = await post(withSession, '/token-create', { password: PASS });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.token);
  });

  await t.test('after five failed attempts it stops — even with the correct password', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await post(withSession, '/change-password', { current: 'falsch' + i, newPassword: 'NeuesPasswort123' });
      assert.equal(r.status, 400, `attempt ${i + 1}`);
    }
    const r = await post(withSession, '/change-password', { current: PASS, newPassword: 'NeuesPasswort123' });
    assert.equal(r.status, 429, JSON.stringify(r.body));
    // The same brake applies to the second factor.
    assert.equal((await post(withSession, '/second-factor/setup', { password: PASS })).status, 429);
  });

  await t.test('a success resets the counter', async () => {
    await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE $1`, [`passwort-bestaetigen|${uid}|%`]);
    for (let i = 0; i < 4; i++) await post(withSession, '/second-factor/setup', { password: 'falsch' });
    assert.equal((await post(withSession, '/second-factor/setup', { password: PASS })).status, 200);
    assert.equal(
      (await post(withSession, '/second-factor/setup', { password: 'falsch' })).status,
      400,
      'after success it counts from the start again',
    );
  });
});
