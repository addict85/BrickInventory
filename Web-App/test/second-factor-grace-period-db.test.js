/**
 * Grace period when setting up the second factor: an admin without a factor
 * (there the server enforces it) who has just logged in with the password
 * (or changed it) sets up without entering it again — once,
 * at most five minutes long, only with a session. Every other account names the password. Without a period and …
 *
 * Counter-checks (measured 04.11.2026, each on its own):
 *   A  `passwordConfirmedAt` never set in signedInResponses → red:
 *      “after login without a password” (400 instead of 200)
 *   B  the `delete` removed in consumeGracePeriod → red: “only once”,
 *      “without a period does not count in the brake”
 *   C  PASSWORD_GRACE_PERIOD_MS set to one hour → red: “after the period expires”
 *   D  the refusal without a period removed in the route (empty password goes into
 *      the check) → red: “only once”, “after the period expires”, “without a period
 *      does not count in the brake”, “never with a token” (current_password_wrong)
 *   E  consumeGracePeriod gives token accesses the period → red: “never with a token”
 *   F  (04.11.) in the route again `!zf.istAktiv(uid)` instead of secondFactorRequired(req)
 *      → red: “an ordinary account always names the password” (200 instead of 400)
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
const { routerServer } = require('./helpers/server');
const db = testData();
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const PASS = 'Gnaden-Passwort-1';

test('grace period when setting up the second factor', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const NAME = `gnade_${process.pid}`,
    USER = `gnade_n_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, USER]]);
  const account = async (n, admin) =>
    (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, $3, $4, true, true) RETURNING id`,
        [n, `${n}@example.org`, await bcrypt.hash(PASS, 4), admin],
      )
    ).id;
  const uid = await account(NAME, true),
    user = await account(USER, false);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, user]]).catch(() => {});
    for (const id of [uid, user])
      await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', [`%|${id}|%`]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  // The session is one object across all requests; the login writes into it.
  const session = {};
  const basis = routerServer(_req, { session, routes: { '/api/v2/auth': 'routes/auth.js' }, t }).base;
  const callFn = async (route, body, head = {}) => {
    const r = await fetch(`${basis}/api/v2/auth${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...head },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  const signIn = async (name = NAME) => {
    for (const k of Object.keys(session)) delete session[k];
    const r = await callFn('/login', { username: name, password: PASS, without_token: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  };
  const setUpAccount = (body = {}) => callFn('/second-factor/setup', body);

  await t.test('after login without a password', async () => {
    await signIn();
    const r = await setUpAccount();
    assert.equal(r.status, 200, `after login without a password: ${JSON.stringify(r.body)}`);
    assert.match(r.body.otpauth, /^otpauth:\/\//);
  });

  await t.test('only once', async () => {
    const r = await setUpAccount();
    assert.deepEqual([r.status, r.body.code], [400, 'current_password_required'], 'only once');
    const withIt = await setUpAccount({ password: PASS });
    assert.equal(withIt.status, 200, 'with a password, on as before');
  });

  await t.test('after the period expires', async () => {
    await signIn();
    session.passwordConfirmedAt = Date.now() - 6 * 60 * 1000;
    const r = await setUpAccount();
    assert.deepEqual([r.status, r.body.code], [400, 'current_password_required'], 'after the grace period expired');
  });

  await t.test('after the password change', async () => {
    await signIn();
    delete session.passwordConfirmedAt;
    const w = await callFn('/change-password', { current: PASS, newPassword: 'Gnaden-Passwort-2' });
    assert.equal(w.status, 200, JSON.stringify(w.body));
    await db.run('UPDATE users SET password_hash = $2 WHERE id = $1', [uid, await bcrypt.hash(PASS, 4)]);
    const r = await setUpAccount();
    assert.equal(r.status, 200, `after the password change: ${JSON.stringify(r.body)}`);
  });

  await t.test('without a period does not count in the brake', async () => {
    for (let i = 0; i < 8; i++) assert.equal((await setUpAccount()).body.code, 'current_password_required');
    const r = await setUpAccount({ password: PASS });
    assert.equal(r.status, 200, `without a grace period it does not count in the throttle: ${JSON.stringify(r.body)}`);
  });

  await t.test('never with a token', async () => {
    for (const k of Object.keys(session)) delete session[k];
    const login = await callFn('/login', { username: NAME, password: PASS });
    assert.ok(login.body.token, JSON.stringify(login.body));
    assert.equal(session.userId, undefined, 'precondition: no session');
    const r = await callFn('/second-factor/setup', {}, { authorization: `Bearer ${login.body.token}` });
    assert.deepEqual([r.status, r.body.code], [400, 'current_password_required'], 'never with a token');
  });

  await t.test('an ordinary account always names the password', async () => {
    await signIn(USER);
    const r = await setUpAccount();
    assert.deepEqual(
      [r.status, r.body.code],
      [400, 'current_password_required'],
      'an ordinary account without a password',
    );
    assert.equal((await setUpAccount({ password: PASS })).status, 200, 'with a password');
  });
});
