/**
 * An administrator deactivates a foreign account: token and session stop applying
 * immediately (not only after the 60 s of the token cache), login is
 * locked, both are in the log; after reactivation login
 * works again. The token query itself checks is_active.
 *
 * Counter-checks (measured 01.11.2026):
 *   A  endAccesses() omitted in setzeAktiv() → red: “token and session
 *      stop applying immediately" (“token still applies": 200 from the cache)
 *   B  `AND u.is_active` removed in validToken() → red: “the token query
 *      checks is_active"
 *   C  the check for the own account removed → red: “not the own
 *      account" (200; the administrator locked themselves out, the cases after follow)
 *   D  (02.11.2026) in checkCredentials() the lock check again as its own
 *      refusal after the password → red: “locked responds like a wrong
 *      password” and “unconfirmed responds like a wrong password” (403)
 *   E  (02.11.2026) in renewEmailTokenIfFree() the pause removed → red:
 *      “a second link immediately afterwards”
 *   F  (26.11.2026) a password check back into PUT /users/:id/active (the
 *      requests carry no password, the session is enough) → red: “token and
 *      session stop applying immediately” (400 instead of 200)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.APP_BASE_URL = 'http://brick.example';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

test('deactivate and reactivate an account', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const CHEF = `deakt_chef_${process.pid}`,
    USER = `deakt_nutzer_${process.pid}`,
    PASS = 'Deakt-Passwort-1';
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[CHEF, USER]]);
  const put = async (name, admin) =>
    (
      await db.get(
        `INSERT INTO users (username, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`,
        [name, bcrypt.hashSync(PASS, 4), admin],
      )
    ).id;
  const chef = await put(CHEF, true),
    user = await put(USER, false);
  // Administrator rights require a code generator; every confirmation takes a recovery code.
  const codes = await require('./helpers/admin').adminWithFactor(_req, chef);
  await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE '%deakt_%'");
  t.after(async () => {
    await db.run('DELETE FROM admin_log WHERE target_id = ANY($1)', [[chef, user]]);
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[chef, user]]);
    await db.pool.end().catch(() => {});
  });

  const app = express();
  app.use(express.json());
  app.use(
    session({
      store: _req('src/account/sessionStore.js').hashSessionIds(
        new pgSession({ pool: db.pool, tableName: 'user_sessions' }),
      ),
      secret: 'deaktivieren-test-geheimnis-lang-genug',
      resave: false,
      saveUninitialized: false,
      name: _req('src/http/sessionCookie.js').sessionCookieName(),
    }),
  );
  app.use(
    '/api/v2',
    _req('routes/api/middleware.js').guardFor(require('./helpers/sources').testServices().account).loginAtInbox,
  );
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2/auth', require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  /** @param {string} method @param {string} path @param {{ body?: unknown, cookie?: string, token?: string }} [o] */
  const callIt = (method, path, { body, cookie, token } = {}) =>
    fetch(`http://127.0.0.1:${srv.address().port}/api/v2/auth${path}`, {
      method: method,
      body: body && JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    }).then(async r => ({
      status: r.status,
      cookie: (r.headers.get('set-cookie') || '').split(';')[0],
      body: await r.json(),
    }));
  const signIn = (name, body = {}) => callIt('POST', '/login', { body: { username: name, password: PASS, ...body } });
  const toggle = (id, active) =>
    callIt('PUT', `/users/${id}/active`, { cookie: chefKeks, body: { is_active: active } });
  const log = async () =>
    (await db.all('SELECT action FROM admin_log WHERE target_id = $1 ORDER BY id', [user])).map(z => z.action);

  const chefKeks = (await signIn(CHEF, { without_token: true, code: codes.shift() })).cookie;
  assert.match(chefKeks, /^bim\.sid=/);

  await t.test('token and session stop applying immediately', async () => {
    const a = { ...(await signIn(USER)), cookie: (await signIn(USER, { without_token: true })).cookie };
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal((await callIt('GET', '/profile', { token: a.body.token })).status, 200);
    assert.equal((await callIt('GET', '/profile', { cookie: a.cookie })).status, 200);

    const r = await toggle(user, false);
    assert.deepEqual([r.status, r.body], [200, { success: true, is_active: false }]);
    assert.equal((await callIt('GET', '/profile', { token: a.body.token })).status, 401, 'Token still valid');
    assert.equal((await callIt('GET', '/profile', { cookie: a.cookie })).status, 401, 'Session still valid');
    assert.equal((await db.get('SELECT count(*)::int n FROM api_tokens WHERE user_id = $1', [user])).n, 0);
  });

  await t.test('login is blocked, the list shows it, the log names it', async () => {
    const a = await signIn(USER);
    const wrong = await callIt('POST', '/login', { body: { username: USER, password: 'Falsches-Passwort-1' } });
    assert.deepEqual([a.status, a.body], [wrong.status, wrong.body], 'locked answers like a wrong password');
    assert.equal(a.body.code, 'credentials_invalid');
    const list = (await callIt('GET', '/users', { cookie: chefKeks })).body.users;
    assert.equal(list.find(u => u.id === user).is_active, false);
    assert.equal(list.find(u => u.id === chef).is_active, true);
    assert.deepEqual(await log(), ['account_deactivated']);
  });

  await t.test('not the own account', async () => {
    const r = await toggle(chef, false);
    assert.deepEqual([r.status, r.body.code], [400, 'deactivate_own_account']);
    assert.equal((await db.get('SELECT is_active FROM users WHERE id = $1', [chef])).is_active, true);
  });

  await t.test('reactivated, the account logs in again', async () => {
    assert.equal((await toggle(user, true)).status, 200);
    const a = await signIn(USER);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal((await callIt('GET', '/profile', { token: a.body.token })).status, 200);
    assert.deepEqual(await log(), ['account_deactivated', 'account_reactivated']);
  });

  await t.test('unconfirmed: the same refusal, new link without account information', async () => {
    const address = `deakt_${process.pid}@example.org`;
    await db.run('UPDATE users SET email = NULL, new_email = $2, registration_pending = true WHERE id = $1', [
      user,
      address,
    ]);
    const a = await signIn(USER);
    const wrong = await callIt('POST', '/login', { body: { username: USER, password: 'Falsches-Passwort-1' } });
    assert.deepEqual([a.status, a.body], [wrong.status, wrong.body], 'unconfirmed answers like a wrong password');
    const retry = email => callIt('POST', '/resend-confirmation', { body: { email } });
    const unknownOne = await retry(`niemand_${process.pid}@example.org`);
    const known = await retry(address.toUpperCase());
    assert.deepEqual(
      [known.status, known.body],
      [unknownOne.status, unknownOne.body],
      'the response reveals the account',
    );
    assert.equal(known.status, 200);
    const z = await db.get(
      "SELECT new_email_token, new_email_until > NOW() + interval '23 hours' AS fresh FROM users WHERE id = $1",
      [user],
    );
    assert.ok(z.new_email_token && z.fresh, 'no new link for the unconfirmed account');
    await retry(address);
    assert.equal(
      (await db.get('SELECT new_email_token FROM users WHERE id = $1', [user])).new_email_token,
      z.new_email_token,
      'a second link right afterwards',
    );
    await db.run(
      `UPDATE users SET email_verified = true, registration_pending = false, new_email = NULL, new_email_token = NULL,
      new_email_until = NULL WHERE id = $1`,
      [user],
    );
    await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE '%deakt_%'");
  });

  await t.test('the token query checks is_active', async () => {
    const auth = _req('src/account/deviceToken.js');
    const tokenCache = _req('src/account/tokenCache.js');
    const token = await auth.createToken(user, 'Probe');
    assert.ok(await auth.userForToken(token));
    await db.run('UPDATE users SET is_active = false WHERE id = $1', [user]);
    tokenCache.emptyTokenCache();
    assert.equal(await auth.userForToken(token), null);
  });
});
