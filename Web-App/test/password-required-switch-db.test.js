/**
 * With the start password (must_change_password) the server only allows the
 * change — for session and app token, not only in the UI.
 *
 * Counter-checks (measured 01.11.2026):
 *   A  the check removed in loginAtInbox → red: „Sitzung kommt am
 *      Wechsel vorbei“ and „Token kommt am Wechsel vorbei“
 *   B  switchMust() only reads the session field (without fallback to the
 *      database) → red: “a session from before the field …”
 *   C  change-password no longer in VOR_DEM_WECHSEL → red: “the change itself works”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
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

const NAME = `pflicht_${process.pid}`,
  PASS = 'start-Passwort-1',
  NEU = 'eigenes-Passwort-2';

test('start password: change it first, then everything else', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_admin, is_active, email_verified, must_change_password)
    VALUES ($1, $2, true, true, true, true) RETURNING id`,
      [NAME, await bcrypt.hash(PASS, 4)],
    )
  ).id;

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
  app.use(
    '/api/v2',
    _req('routes/api/middleware.js').guardFor(require('./helpers/sources').testServices().account).loginAtInbox,
  );
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2', require('./helpers/sources').routerFrom(_req, 'routes/api/index.js'));
  app.use('/api/v2/auth', require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  // Like startup/app.ts: an error path behind everything, also behind the entrance.
  app.use(_req('src/http/httpResponse.js').errorResponse);
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}/api/v2`;
  t.after(async () => {
    await new Promise(r => srv.close(r));
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', [`%konto:${uid}%`]);
    await db.pool.end().catch(() => {});
  });
  /** @param {string} weg @param {{ body?: unknown, cookie?: string, token?: string }} [o] */
  const callFn = async (weg, { body, cookie, token } = {}) => {
    const r = await fetch(basis + weg, {
      method: body ? 'POST' : 'GET',
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: r.status,
      cookie: r.headers.get('set-cookie')?.split(';')[0],
      body: await r.json().catch(() => null),
    };
  };

  const anmeldung = await callFn('/auth/login', { body: { username: NAME, password: PASS } });
  assert.equal(anmeldung.status, 200, JSON.stringify(anmeldung.body));
  assert.equal(anmeldung.body.user.mustChangePassword, true);
  const {
    body: { token },
  } = anmeldung;
  const { cookie } = await callFn('/auth/login', { body: { username: NAME, password: PASS, without_token: true } });

  await t.test('session and token only get as far as the change', async () => {
    const s = await callFn('/settings/tokens', { cookie });
    assert.equal(s.status, 403, 'Sitzung kommt am Wechsel vorbei');
    assert.equal(s.body.code, 'password_change_required');
    const k = await callFn('/settings/tokens', { token });
    assert.equal(k.status, 403, 'Token kommt am Wechsel vorbei');
    const ich = await callFn('/auth/me', { cookie });
    assert.equal(ich.status, 200);
    assert.equal(ich.body.user.mustChangePassword, true, '/me sagt der Oberfläche nichts vom Wechsel');
  });

  await t.test('a session from before the field asks the database', async () => {
    const sid = _req('src/account/sessionStore.js').sessionDigest(
      decodeURIComponent(cookie.split('=')[1]).slice(2).split('.')[0],
    );
    await db.run(`UPDATE user_sessions SET sess = (sess::jsonb - 'mussPasswortAendern')::json WHERE sid = $1`, [sid]);
    assert.equal((await callFn('/settings/tokens', { cookie })).status, 403);
  });

  await t.test('the change itself works, afterwards (as an admin with a second factor) everything', async () => {
    const w = await callFn('/auth/change-password', { cookie, body: { current: PASS, newPassword: NEU } });
    assert.equal(w.status, 200, JSON.stringify(w.body));
    const neu = w.cookie ?? cookie;
    // Since 04.11.2026 admin rights require a code generator afterwards.
    assert.equal((await callFn('/settings/tokens', { cookie: neu })).body.code, 'second_factor_mandatory');
    await require('./helpers/admin').adminWithFactor(_req, uid);
    assert.equal((await callFn('/settings/tokens', { cookie: neu })).status, 200);
    assert.equal((await callFn('/auth/me', { cookie: neu })).body.user.mustChangePassword, false);
  });
});
