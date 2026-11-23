/**
 * The sliding expiry of the app token — real database.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';
// Not the default 90: this way the test shows that the period comes from the configuration.
process.env.TOKEN_IDLE_DAYS = '23';

const { buildAndRequire, mounting, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { until } = require('./helpers/time');
const AUTH = mounting('auth');
const db = testData();
const auth = _req('src/account/deviceToken.js');
const tokenCache = _req('src/account/tokenCache.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAME = 'gleitfrist_test',
  PASS = 'richtigesPasswort1';
const TAG = 86400_000;

test('the expiry date of the app token slides with use', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  await db.run(
    'INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,false,true,true)',
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
  const basis = `http://localhost:${srv.address().port}`;

  const callFn = async (route, opt = {}) => {
    const r = await fetch(basis + route, {
      method: opt.method || 'GET',
      headers: { 'content-type': 'application/json', ...(opt.headers || {}) },
      ...(opt.body ? { body: JSON.stringify(opt.body) } : {}),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const row = plaintext =>
    db.get('SELECT expires_at, sliding FROM api_tokens WHERE token = $1', [auth.tokenDigest(plaintext)]);

  try {
    const deadline = _req('src/infra/config.js').config().tokenIdleDays;
    assert.equal(deadline, 23, 'the period comes from TOKEN_IDLE_DAYS');

    // ── 1. The app token ────────────────────────────────────────────────────
    const appA = await callFn(AUTH + '/login', {
      method: 'POST',
      body: { username: NAME, password: PASS, label: 'Android App', never_expires: true },
    });
    assert.equal(appA.status, 200, `login failed: ${JSON.stringify(appA.body)}`);
    const appToken = appA.body.token;
    const appRow = await row(appToken);
    assert.equal(appRow.sliding, true, 'The app token must be marked as sliding');
    // Exact to the day instead of to the millisecond: between the INSERT and
    // this line real time passes, and NOW() is that of the database.
    const daysUntil = d => Math.round((new Date(d).getTime() - Date.now()) / TAG);
    assert.equal(
      daysUntil(appRow.expires_at),
      deadline,
      `The app token must run for ${deadline} days — the period is in TOKEN_IDLE_DAYS`,
    );

    // ── 2. The browser token does not slide ──────────────────────────────────
    const webA = await callFn(AUTH + '/login', { method: 'POST', body: { username: NAME, password: PASS } });
    const webRow = await row(webA.body.token);
    assert.equal(
      webRow.sliding,
      false,
      'The token in sessionStorage must NOT slide — otherwise an attacker keeps it alive by using it',
    );
    assert.equal(daysUntil(webRow.expires_at), 7, "The browser's seven fixed days stay");

    // 3. The silent renewal
    await db.run("UPDATE api_tokens SET expires_at = NOW() + INTERVAL '3 days' WHERE token = $1", [
      auth.tokenDigest(appToken),
    ]);
    tokenCache.emptyTokenCache();
    const who = await callFn(AUTH + '/me', { headers: { authorization: `Bearer ${appToken}` } });
    assert.equal(who.body?.user?.id, uid, 'precondition: the request must get through at all');

    // The UPDATE runs without await in the request path (fire-and-forget, so that
    // auth does not cost two DB rounds). Hence we wait instead of guess —
    // a fixed sleep would be either too short or a waste of time.
    await until(async () => daysUntil((await row(appToken)).expires_at) > 3, 2000);
    assert.equal(
      daysUntil((await row(appToken)).expires_at),
      deadline,
      'Use must push the expiry date back to the full period — otherwise ' +
        'a phone used daily locks itself out after 90 days',
    );

    // Counter-check in the same situation: the browser token is used just the same and
    // must NOT extend itself.
    await db.run("UPDATE api_tokens SET expires_at = NOW() + INTERVAL '3 days' WHERE token = $1", [
      auth.tokenDigest(webA.body.token),
    ]);
    tokenCache.emptyTokenCache();
    await callFn(AUTH + '/me', { headers: { authorization: `Bearer ${webA.body.token}` } });
    // The touch writes last_used; only afterwards is it certain that it did not push the period.
    assert.ok(
      await until(
        async () =>
          (await db.get('SELECT last_used FROM api_tokens WHERE token = $1', [auth.tokenDigest(webA.body.token)]))
            ?.last_used,
      ),
      'the use was not recorded',
    );
    assert.equal(
      daysUntil((await row(webA.body.token)).expires_at),
      3,
      'The browser token must not get longer through use',
    );

    // 4. Update legacy rows
    const alt = 'a'.repeat(64);
    await db.run('DELETE FROM api_tokens WHERE token = $1', [alt]);
    await db.run(
      `INSERT INTO api_tokens (token, user_id, label, expires_at, created_at, last_used)
       VALUES ($1,$2,'Altzeile',NULL, NOW() - INTERVAL '40 days', NOW() - INTERVAL '10 days')`,
      [alt, uid],
    );
    await auth.tokensCleanup();
    const followedUp = await db.get('SELECT expires_at, sliding FROM api_tokens WHERE token = $1', [alt]);
    assert.ok(followedUp, 'The legacy row must not be deleted — it is still valid');
    assert.equal(followedUp.sliding, true, 'A legacy row without a date was an app/QR token and slides');
    assert.equal(
      Math.round((new Date(followedUp.expires_at).getTime() - Date.now()) / TAG),
      deadline - 10,
      'It is extended from the last use, not from now — otherwise the migration extends every legacy row',
    );

    // 5. A legacy row that was never used counts from its creation and falls.
    // Counter-check (measured 11.11.2026): in tokensCleanup() the sum replaced by 0
    // → red „das Aufräumen zählt …“.
    const nie = 'b'.repeat(64);
    await db.run('DELETE FROM api_tokens WHERE token = $1', [nie]);
    await db.run(
      `INSERT INTO api_tokens (token, user_id, label, expires_at, created_at, last_used)
       VALUES ($1,$2,'Nie benutzt',NULL, NOW() - INTERVAL '40 days', NULL)`,
      [nie, uid],
    );
    assert.ok((await auth.tokensCleanup()) >= 1, 'the cleanup counts what it removes');
    assert.equal(
      await db.get('SELECT 1 FROM api_tokens WHERE token = $1', [nie]),
      undefined,
      'a never-used legacy row is past the period of 23 after 40 days',
    );
  } finally {
    // Both AWAITED, and the pool is closed: without that the
    // file does not run to the end but into the 60-second time limit of
    // `npm test` — the checks in it have long been green, the file counts
    // as failed nevertheless. Exactly that happened when writing this test …
    await new Promise(r => srv.close(r));
    await db.run('DELETE FROM users WHERE username = $1', [NAME]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
