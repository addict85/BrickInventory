/**
 * The ONE login — played through, not read.
 *
 * Counter-check (14.11.2026): in POST /logout again `deleteToken(…).catch(logAndContinue(…))`
 * → red: „Ein Token, der gültig bleibt, darf nicht als abgemeldet gelten“ (200 instead of 500).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const AUTH = require('./helpers/sources').mounting('auth');
const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAME = 'eine_anmeldung',
  PASS = 'richtigesPasswort1';

test('one address, two credentials — played through', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  // Few rounds: here the WIRING is checked, not the run time —
  // that is measured by test/login-time-equal-db.test.js, and there the real
  // costs are part of the statement.
  await db.run(
    'INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,true,true,true)',
    [NAME, await bcrypt.hash(PASS, 4)],
  );
  const uid = (await db.get('SELECT id FROM users WHERE username=$1', [NAME])).id;

  const app = express();
  app.use(express.json());
  app.use(
    session({
      store: _req('src/account/sessionStore.js').hashSessionIds(
        new pgSession({ pool: db.pool, tableName: 'user_sessions' }),
      ),
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
    }),
  );
  app.use(AUTH, require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}${AUTH}`;

  const callFn = async (route, opt = {}) => {
    const r = await fetch(basis + route, {
      method: opt.method || 'GET',
      headers: { 'content-type': 'application/json', ...(opt.headers || {}) },
      ...(opt.body ? { body: JSON.stringify(opt.body) } : {}),
    });
    return { status: r.status, cookie: r.headers.get('set-cookie'), body: await r.json().catch(() => null) };
  };
  const expiry = async token =>
    db.get('SELECT expires_at FROM api_tokens WHERE token = $1', [
      _req('src/account/deviceToken.js').tokenDigest(token),
    ]);

  try {
    // ── 1. Without never_expires: a token with seven fixed days, no cookie ──
    const short = await callFn('/login', { method: 'POST', body: { username: NAME, password: PASS } });
    assert.equal(short.status, 200, `Sign-in failed: ${JSON.stringify(short.body)}`);
    assert.equal(short.body.success, true);
    assert.equal(short.cookie, null, 'A sign-in with a token carries no session cookie');
    assert.ok(short.body.token);
    assert.equal(short.body.never_expires, false);
    assert.equal(short.body.user.is_admin, true, 'The app reads is_admin — the field must be there');
    const webToken = short.body.token;
    assert.ok((await expiry(webToken))?.expires_at, 'The short token must have an expiry date');
    // The browser: only the session.
    const web = await callFn('/login', {
      method: 'POST',
      body: { username: NAME, password: PASS, without_token: true },
    });
    assert.ok(web.cookie, 'Without Set-Cookie there is no session — the browser would not be signed in');
    assert.equal(web.body.token, undefined);
    const webCookie = web.cookie.split(';')[0];

    // 2. The app: sliding deadline instead of none at all
    const app1 = await callFn('/login', {
      method: 'POST',
      // Scope `voll`: a token only gets admin rights on explicit request.
      body: { username: NAME, password: PASS, label: 'Android App', never_expires: true, scope: 'voll' },
    });
    assert.equal(app1.status, 200, `Sign-in of the app failed: ${JSON.stringify(app1.body)}`);
    assert.equal(
      app1.body.never_expires,
      false,
      'With the sliding deadline switched on no token is „ohne Ablauf“ — the response must not claim that',
    );
    const appToken = app1.body.token;
    const appRow = await db.get('SELECT expires_at, sliding FROM api_tokens WHERE token = $1', [
      _req('src/account/deviceToken.js').tokenDigest(appToken),
    ]);
    assert.ok(
      appRow.expires_at,
      'The app token needs a real expiry date — otherwise the deadline depends on a background job',
    );
    assert.equal(
      appRow.sliding,
      true,
      'Without sliding the date does not move on use — then one would have to type again every 90 days',
    );
    // And it is valid considerably longer than the browser's: whoever opens the app
    // should not have to type in their password weekly.
    assert.ok(
      new Date(appRow.expires_at) > new Date((await expiry(webToken)).expires_at),
      'The app token must run longer than the seven fixed days',
    );
    // Precondition: these are two DIFFERENT tokens, otherwise the rest checks nothing.
    assert.notEqual(webToken, appToken);

    // ── 3. Who am I? ─────────────────────────────────────────────────────
    const withCookie = await callFn('/me', { headers: { cookie: webCookie } });
    assert.equal(withCookie.status, 200);
    assert.equal(withCookie.body.loggedIn, true, 'The browser session is not recognized');
    assert.equal(withCookie.body.user.id, uid);

    const withToken = await callFn('/me', { headers: { authorization: `Bearer ${appToken}` } });
    assert.equal(withToken.status, 200);
    assert.equal(withToken.body.loggedIn, true, 'The app token is not recognized');
    assert.equal(withToken.body.user.is_admin, true);

    // Without anything: 200 and „no". The browser asks this BEFORE every login —
    // a 401 there would be the normal answer to a normal question.
    const without = await callFn('/me');
    assert.equal(without.status, 200, 'Without credentials „nicht angemeldet“ is not a failure');
    assert.equal(without.body.loggedIn, false);

    // With a token that does not exist: 401. The interceptor of the app makes
    // „Sitzung abgelaufen" out of it and leads back to the login
    // (RepoBasis.kt). With 200 it would stay with a dead token.
    const wrong = await callFn('/me', { headers: { authorization: 'Bearer ' + 'f'.repeat(64) } });
    assert.equal(
      wrong.status,
      401,
      'A presented invalid token must result in 401 — otherwise the app does not notice the expiry',
    );

    // ── 3b. If the invalidation fails, the logout has not succeeded ───────
    const account = require('./helpers/sources').testServices().account;
    const original = account.deleteToken;
    account.deleteToken = async () => {
      throw new Error('Database gone');
    };
    try {
      const half = await callFn('/logout', { method: 'POST', headers: { authorization: `Bearer ${webToken}` } });
      assert.equal(half.status, 500, 'A token that stays valid must not count as signed out');
      assert.ok(await expiry(webToken), 'The token is still there');
    } finally {
      account.deleteToken = original;
    }

    // ── 4. Logging out invalidates BOTH ────────────────────────────────────────
    const ab = await callFn('/logout', {
      method: 'POST',
      headers: { cookie: webCookie, authorization: `Bearer ${webToken}` },
    });
    assert.equal(ab.status, 200);
    assert.equal(await expiry(webToken), undefined, 'The token must disappear on sign-out');
    const afterwards = await callFn('/me', { headers: { cookie: webCookie } });
    assert.equal(afterwards.body.loggedIn, false, 'The session must end on sign-out');
    // The token of the app is NOT affected by it — the browser logged out.
    const appStill = await callFn('/me', { headers: { authorization: `Bearer ${appToken}` } });
    assert.equal(appStill.body.loggedIn, true, 'Signing out in the browser must not sign out the phone too');

    // ── 5. A wrong password stays wrong ──────────────────────────────────
    const beside = await callFn('/login', { method: 'POST', body: { username: NAME, password: 'falsch' } });
    assert.equal(beside.status, 401);
    assert.equal(beside.body.token, undefined, 'A failed sign-in must not issue a token');
  } finally {
    await new Promise(r => srv.close(r));
    await db.run('DELETE FROM users WHERE username = $1', [NAME]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
