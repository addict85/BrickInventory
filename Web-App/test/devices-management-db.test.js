/**
 * Signed-in devices: list and lock out — both paths, real database.
 *
 * Counter-check (measured 09.11.2026): in DELETE /settings/tokens/:tokenId the
 * confirmation deleted → red: “without a password one device locks no other out”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire, mounting, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const AUTH = mounting('auth');
const SETTINGS = '/api/v2/settings';
const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAME = 'geraete_test',
  PASS = 'richtigesPasswort1';

test('list and lock out accesses — via session AND via token', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  await db.run(
    'INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,false,true,true)',
    [NAME, await bcrypt.hash(PASS, 4)],
  );

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
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2', require('./helpers/sources').routerFrom(_req, 'routes/api/settings.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}`;

  const callFn = async (route, opt = {}) => {
    const r = await fetch(basis + route, {
      method: opt.method || 'GET',
      headers: { 'content-type': 'application/json', ...(opt.headers || {}) },
      ...(opt.body ? { body: JSON.stringify(opt.body) } : {}),
    });
    return { status: r.status, cookie: r.headers.get('set-cookie'), body: await r.json().catch(() => null) };
  };
  const signIn = (extra = {}) =>
    callFn(AUTH + '/login', { method: 'POST', body: { username: NAME, password: PASS, ...extra } });

  try {
    // Three logins: a browser and two “phones" with their own labels.
    const browser = await signIn();
    assert.equal(browser.status, 200, JSON.stringify(browser.body));
    const phone = await signIn({ label: 'Pixel 8', never_expires: true });
    const tablet = await signIn({ label: 'Tablet', never_expires: true });
    // Session and token come from separate logins: a token login creates no session.
    const cookie = (await signIn({ without_token: true })).cookie.split(';')[0];

    // ── 1. Via the SESSION (web app) ────────────────────────────────────────
    const perSession = await callFn(SETTINGS + '/tokens', { headers: { cookie } });
    assert.equal(perSession.status, 200, JSON.stringify(perSession.body));
    assert.equal(perSession.body.tokens.length, 3, 'All three sign-ins must show up');
    // The session ALONE says nothing about which row belongs to it —
    // the client must send its token along. Exactly that is checked by the next
    // block; so nothing may be marked here yet.
    assert.equal(
      perSession.body.tokens.filter(x => x.current).length,
      0,
      'Without a token sent along no row is recognizable as „dieses Gerät“',
    );

    const withOwn = await callFn(SETTINGS + '/tokens', {
      headers: { cookie, authorization: `Bearer ${browser.body.token}` },
    });
    const marked = withOwn.body.tokens.filter(x => x.current);
    assert.equal(marked.length, 1, 'Exactly one row is „dieses Gerät“');
    assert.equal(marked[0].label, 'webapp-session');
    // The token itself must NOT come out — only a piece of its hash.
    assert.ok(
      !JSON.stringify(withOwn.body).includes(browser.body.token),
      'The plain-text token must not appear in the overview',
    );

    // ── 2. Via the TOKEN (app) ──────────────────────────────────────────────
    // Previously that was not possible at all: the route hung on the session, and the
    // app has none.
    const perToken = await callFn(SETTINGS + '/tokens', { headers: { authorization: `Bearer ${phone.body.token}` } });
    assert.equal(perToken.status, 200, 'The app must be able to see its accesses');
    assert.equal(perToken.body.tokens.length, 3);
    assert.equal(perToken.body.tokens.find(x => x.current)?.label, 'Pixel 8');
    // And the lifetimes are in there correctly — the display depends on that.
    for (const label of ['Pixel 8', 'webapp-session']) {
      const row = perToken.body.tokens.find(x => x.label === label);
      assert.equal(row.never_expires, false, `${label}: no token expires „nie“ anymore`);
      assert.ok(row.expires_at, `${label}: without a date the display has nothing to show`);
    }
    // The phone's runs longer than the browser's — otherwise the
    // sliding period would be no relief but a tightening.
    assert.ok(
      new Date(perToken.body.tokens.find(x => x.label === 'Pixel 8').expires_at) >
        new Date(perToken.body.tokens.find(x => x.label === 'webapp-session').expires_at),
      'The app token must run longer than the seven days of the browser',
    );

    // 3. Lock out a foreign device
    const warmUp = await callFn(AUTH + '/me', { headers: { authorization: `Bearer ${tablet.body.token}` } });
    assert.equal(
      warmUp.body.loggedIn,
      true,
      'Precondition: the tablet token must be valid BEFORE the deletion and thus be in the cache',
    );

    const deleteTo = perToken.body.tokens.find(x => x.label === 'Tablet');
    const without = await callFn(SETTINGS + '/tokens/' + deleteTo.token_id, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${phone.body.token}` },
    });
    assert.equal(without.status, 400, 'without a password one device does not lock out another');
    const route = await callFn(SETTINGS + '/tokens/' + deleteTo.token_id, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${phone.body.token}` },
      body: { password: PASS },
    });
    assert.equal(route.status, 200);
    assert.equal(route.body.deleted, 1);

    // And REALLY: the tablet's token no longer applies. That is the
    // point of the whole exercise — deleting the row is only half the job
    // if the cache in src/account/tokenCache.ts still serves it.
    const tabletTried = await callFn(AUTH + '/me', { headers: { authorization: `Bearer ${tablet.body.token}` } });
    assert.equal(
      tabletTried.status,
      401,
      'The locked-out access is still valid — then the whole management is useless',
    );

    // The other two stay.
    const afterwards = await callFn(SETTINGS + '/tokens', { headers: { authorization: `Bearer ${phone.body.token}` } });
    assert.deepEqual(afterwards.body.tokens.map(x => x.label).sort(), ['Pixel 8', 'webapp-session']);

    // ── 4. Foreign accesses are off limits ──────────────────────────────────
    // The filter goes via user_id. Without it every logged-in user could invalidate
    // any access if they guessed the start of the hash.
    await db.run('DELETE FROM users WHERE username = $1', [NAME + '_fremd']);
    await db.run(
      'INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,false,true,true)',
      [NAME + '_fremd', await bcrypt.hash(PASS, 4)],
    );
    const fremd = await callFn(AUTH + '/login', {
      method: 'POST',
      body: { username: NAME + '_fremd', password: PASS, label: 'Fremd', never_expires: true },
    });
    const foreignView = await callFn(SETTINGS + '/tokens', {
      headers: { authorization: `Bearer ${fremd.body.token}` },
    });
    assert.deepEqual(
      foreignView.body.tokens.map(x => x.label),
      ['Fremd'],
      'A foreign account must not see the own accesses',
    );
    const foreignAttempt = await callFn(SETTINGS + '/tokens/' + afterwards.body.tokens[0].token_id, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${fremd.body.token}` },
      body: { password: PASS },
    });
    assert.equal(foreignAttempt.body.deleted, 0, 'A foreign account must not invalidate any access');

    // ── 5. The % case: only the full identifier (16 hex characters) applies ──
    const alles = await callFn(SETTINGS + '/tokens/' + encodeURIComponent('%'), {
      method: 'DELETE',
      headers: { authorization: `Bearer ${phone.body.token}` },
    });
    // Since 05.11.2026 the contract (PATH) already rejects the identifier.
    assert.equal(alles.status, 400, 'A "%" as token ID must not delete all accesses at once');
  } finally {
    await new Promise(r => srv.close(r));
    await db.run('DELETE FROM users WHERE username IN ($1, $2)', [NAME, NAME + '_fremd']).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
