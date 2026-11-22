/**
 * Administrator rights require a second factor: an administrator without TOTP and
 * without passkey only gets as far as setting it up after login (403
 * second_factor_mandatory), login and /auth/me tell the UI.
 * An ordinary account and an app token (scope `app`) of an administrator are …
 *
 * Counter-checks (measured on 04.11.2026, one change each, reverted afterwards):
 *   A  in loginAtInbox the check secondFactorRequired deleted → red:
 *      “without second factor only its setup”, “… app token …” (the full
 *      token gets through) and “a passkey suffices”
 *   B  /zweiter-faktor/einrichten deleted from TO_SETUP → red:
 *      “… setup works, then everything”
 *   C  secondFactorRequired() also counts passkeys (hatPasskeys) → red: “a
 *      passkey alone does not suffice”
 *   D  in signedInResponses `secondFactorRequired` always false → red:
 *      “login and /auth/me name the obligation”
 *
 * REQUIRE_DB=1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testData();
const zf = _req('src/factors/secondFactor.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const { portOf } = require('./helpers/server');
const PASS = 'Verwalter-Passwort-1';

/** Like server.ts: entrance before the routes; the session is fixed. */
function server(t, sitzung, token) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    /** @type {any} */ (req).session = Object.assign(sitzung, {
      save: cb => cb?.(),
      regenerate: cb => cb?.(),
      destroy: cb => cb?.(),
    });
    next();
  });
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
  t.after(() => new Promise(r => srv.close(r)));
  const base = `http://localhost:${portOf(srv)}/api/v2`;
  return async (methode, weg, body) => {
    const r = await fetch(base + weg, {
      method: methode,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
}

test('second factor for admins', { concurrency: 1 }, async t => {
  try {
    await db.initSchema();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }
  const P = process.pid,
    NAMEN = [`zfp_chef_${P}`, `zfp_nutzer_${P}`, `zfp_pk_${P}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]);
  const konto = async (name, admin) =>
    (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, $3, $4, true, true) RETURNING id`,
        [name, `${name}@example.org`, await bcrypt.hash(PASS, 4), admin],
      )
    ).id;
  const chef = await konto(NAMEN[0], true),
    nutzer = await konto(NAMEN[1], false),
    withPk = await konto(NAMEN[2], true);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const alsChef = server(t, { userId: chef, username: NAMEN[0], isAdmin: true });

  await t.test('login and /auth/me name the obligation', async () => {
    const anonym = server(t, {});
    const voll = await anonym('POST', '/auth/login', { username: NAMEN[0], password: PASS, scope: 'voll' });
    assert.equal(voll.status, 200, JSON.stringify(voll.body));
    assert.equal(voll.body.user.secondFactorRequired, true);
    const app = await anonym('POST', '/auth/login', { username: NAMEN[0], password: PASS });
    assert.equal(app.body.user.secondFactorRequired, false, 'ein App-Token trägt keine Verwalterrechte');
    assert.equal((await alsChef('GET', '/auth/me')).body.user.secondFactorRequired, true);
  });

  await t.test('without a second factor only its setup', async () => {
    const r = await alsChef('GET', '/settings');
    assert.deepEqual([r.status, r.body.code], [403, 'second_factor_mandatory']);
    assert.equal((await alsChef('GET', '/auth/users')).status, 403);
    assert.equal((await alsChef('GET', '/auth/second-factor')).status, 200);
  });

  await t.test('an ordinary account and an app token are not affected', async () => {
    assert.equal(
      (await server(t, { userId: nutzer, username: NAMEN[1], isAdmin: false })('GET', '/settings')).status,
      200,
    );
    const { createToken } = _req('src/account/deviceToken.js');
    const app = server(t, {}, await createToken(chef, 'app', false, null, { scope: 'app' }));
    assert.equal((await app('GET', '/settings')).status, 200);
    const voll = server(t, {}, await createToken(chef, 'voll', false, null, { scope: 'voll' }));
    assert.equal((await voll('GET', '/settings')).status, 403);
  });

  await t.test('… the setup works, afterwards everything', async () => {
    const e = await alsChef('POST', '/auth/second-factor/setup', { password: PASS });
    assert.equal(e.status, 200, JSON.stringify(e.body));
    const code = zf.hotp(zf.fromBase32(e.body.secret), zf.timeStep());
    const b = await alsChef('POST', '/auth/second-factor/confirm', { code });
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.equal((await alsChef('GET', '/settings')).status, 200);
    assert.equal((await alsChef('GET', '/auth/me')).body.user.secondFactorRequired, false);
  });

  await t.test('a passkey alone is not enough', async () => {
    const pk = server(t, { userId: withPk, username: NAMEN[2], isAdmin: true });
    await db.run(`INSERT INTO passkeys (user_id, credential_id, public_key) VALUES ($1, $2, '\\x00')`, [
      withPk,
      `pk-${P}`,
    ]);
    assert.equal((await pk('GET', '/settings')).status, 403);
  });
});
