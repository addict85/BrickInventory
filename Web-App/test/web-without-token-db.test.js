/**
 * The web app signs in only with the httpOnly cookie — without a bearer token
 * that an injected script could read from sessionStorage. “Sign out all
 * others” therefore also ends the other browser sessions.
 *
 * Counter-checks (measured 27.10.):
 *   A  `ohne_token` ignored in POST /login → red: “no token for the browser”,
 *      plus the two following ones (the counts no longer match afterwards)
 *   B  in /sessions/andere-beenden `AND sid <> $2` removed → red: “the own
 *      session stays” (the own one was ended too)
 *   C  (02.11.2026) in /sessions/andere-beenden bestaetigePasswort() removed
 *      → red: “the own session stays” (200 instead of 400 with a wrong password)
 *   D  (03.11.2026) in signedInResponses() the session created again also with
 *      a token → red: “the app gets its token and no session” (cookie
 *      next to the token) and “the own session stays” (three instead of two)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
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
const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAME = `ohnetoken_${process.pid}`,
  PASS = 'richtigesPasswort1';

test('browser without token', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified) VALUES ($1, $2, true, true) RETURNING id`,
      [NAME, await bcrypt.hash(PASS, 4)],
    )
  ).id;

  const KEKS = _req('src/http/sessionCookie.js').sessionCookieName();
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
      name: KEKS,
    }),
  );
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2/auth', require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  app.use('/api/v2', require('./helpers/sources').routerFrom(_req, 'routes/api/settings.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}/api/v2`;
  t.after(async () => {
    await new Promise(r => srv.close(r));
    await db.run("DELETE FROM user_sessions WHERE sess::jsonb->>'userId' = $1", [String(uid)]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  /** @param {string} weg @param {{ method?: string, body?: unknown, cookie?: string }} [o] */

  const callFn = async (weg, { method = 'GET', body, cookie } = {}) => {
    const r = await fetch(basis + weg, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: r.status,
      cookie: (r.headers.get('set-cookie') || '').split(';')[0],
      body: await r.json().catch(() => null),
    };
  };
  const anmelden = zusatz =>
    callFn('/auth/login', { method: 'POST', body: { username: NAME, password: PASS, ...zusatz } });
  const tokens = async () => Number((await db.get('SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = $1', [uid])).n);
  const sitzungen = async () =>
    Number(
      (await db.get("SELECT COUNT(*) AS n FROM user_sessions WHERE sess::jsonb->>'userId' = $1", [String(uid)])).n,
    );

  let eigene;
  await t.test('no token for the browser', async () => {
    const r = await anmelden({ without_token: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.token, undefined, 'The browser gets a token that a script could read');
    assert.equal(await tokens(), 0);
    assert.ok(r.cookie.startsWith(`${KEKS}=`), 'Without a token the session must carry');
    eigene = r.cookie;
  });

  await t.test('the app gets its token and no session', async () => {
    const vorher = await sitzungen();
    const r = await anmelden({ label: 'Android App', never_expires: true });
    assert.ok(r.body.token, 'The app can do nothing without a token');
    assert.equal(r.body.token_info?.scope, 'app');
    assert.equal(await tokens(), 1);
    assert.equal(r.cookie, '', "Next to the token a session cookie with the account's full rights");
    assert.equal(await sitzungen(), vorher, 'The token login creates a session');
    const profileData = await fetch(basis + '/auth/profile', { headers: { authorization: `Bearer ${r.body.token}` } });
    assert.equal(profileData.status, 200, 'The token alone carries the app');
  });

  await t.test('the own session stays', async () => {
    await anmelden({ without_token: true }); // a second browser
    assert.equal(await sitzungen(), 2, 'precondition: two sessions (two browsers; the app has none)');
    const ohne = await callFn('/settings/sessions/end-others', {
      method: 'POST',
      cookie: eigene,
      body: { password: 'falsch-1234' },
    });
    assert.deepEqual([ohne.status, ohne.body?.code], [400, 'current_password_wrong']);
    assert.equal(await sitzungen(), 2, 'sessions were ended without the right password');
    const r = await callFn('/settings/sessions/end-others', {
      method: 'POST',
      cookie: eigene,
      body: { password: PASS },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.deleted, 1);
    assert.equal(await sitzungen(), 1);
    assert.equal((await callFn('/auth/profile', { cookie: eigene })).status, 200, 'The own session was ended as well');
  });
});
