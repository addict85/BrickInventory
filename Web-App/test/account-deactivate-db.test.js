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
    NUTZER = `deakt_nutzer_${process.pid}`,
    PASS = 'Deakt-Passwort-1';
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[CHEF, NUTZER]]);
  const put = async (name, admin) =>
    (
      await db.get(
        `INSERT INTO users (username, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`,
        [name, bcrypt.hashSync(PASS, 4), admin],
      )
    ).id;
  const chef = await put(CHEF, true),
    nutzer = await put(NUTZER, false);
  // Administrator rights require a code generator; every confirmation takes a recovery code.
  const codes = await require('./helpers/admin').adminWithFactor(_req, chef);
  await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE '%deakt_%'");
  t.after(async () => {
    await db.run('DELETE FROM admin_log WHERE target_id = ANY($1)', [[chef, nutzer]]);
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[chef, nutzer]]);
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
    _req('routes/api_v1/middleware.js').guardFor(require('./helpers/sources').testServices().account).loginAtInbox,
  );
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2/auth', require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  /** @param {string} methode @param {string} path @param {{ body?: unknown, cookie?: string, token?: string }} [o] */
  const rufe = (methode, path, { body, cookie, token } = {}) =>
    fetch(`http://127.0.0.1:${srv.address().port}/api/v2/auth${path}`, {
      method: methode,
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
  const anmelden = (name, body = {}) => rufe('POST', '/login', { body: { username: name, password: PASS, ...body } });
  const schalte = (id, active, pw = PASS) =>
    rufe('PUT', `/users/${id}/active`, {
      cookie: chefKeks,
      body: { is_active: active, admin_password: pw, code: codes.shift() },
    });
  const protokoll = async () =>
    (await db.all('SELECT action FROM admin_log WHERE target_id = $1 ORDER BY id', [nutzer])).map(z => z.action);

  const chefKeks = (await anmelden(CHEF, { without_token: true, code: codes.shift() })).cookie;
  assert.match(chefKeks, /^bim\.sid=/);

  await t.test('token and session stop applying immediately', async () => {
    const a = { ...(await anmelden(NUTZER)), cookie: (await anmelden(NUTZER, { without_token: true })).cookie };
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal((await rufe('GET', '/profile', { token: a.body.token })).status, 200);
    assert.equal((await rufe('GET', '/profile', { cookie: a.cookie })).status, 200);

    const r = await schalte(nutzer, false);
    assert.deepEqual([r.status, r.body], [200, { success: true, is_active: false }]);
    assert.equal((await rufe('GET', '/profile', { token: a.body.token })).status, 401, 'Token gilt weiter');
    assert.equal((await rufe('GET', '/profile', { cookie: a.cookie })).status, 401, 'Sitzung gilt weiter');
    assert.equal((await db.get('SELECT count(*)::int n FROM api_tokens WHERE user_id = $1', [nutzer])).n, 0);
  });

  await t.test('login is blocked, the list shows it, the log names it', async () => {
    const a = await anmelden(NUTZER);
    const falsch = await rufe('POST', '/login', { body: { username: NUTZER, password: 'Falsches-Passwort-1' } });
    assert.deepEqual([a.status, a.body], [falsch.status, falsch.body], 'gesperrt antwortet wie ein falsches Passwort');
    assert.equal(a.body.code, 'credentials_invalid');
    const liste = (await rufe('GET', '/users', { cookie: chefKeks })).body.users;
    assert.equal(liste.find(u => u.id === nutzer).is_active, false);
    assert.equal(liste.find(u => u.id === chef).is_active, true);
    assert.deepEqual(await protokoll(), ['konto_deaktiviert']);
  });

  await t.test('without the admin password nothing changes', async () => {
    const r = await schalte(nutzer, true, 'falsch');
    assert.equal(r.status, 400);
    assert.equal((await db.get('SELECT is_active FROM users WHERE id = $1', [nutzer])).is_active, false);
  });

  await t.test('not the own account', async () => {
    const r = await schalte(chef, false);
    assert.deepEqual([r.status, r.body.code], [400, 'deactivate_own_account']);
    assert.equal((await db.get('SELECT is_active FROM users WHERE id = $1', [chef])).is_active, true);
  });

  await t.test('reactivated, the account logs in again', async () => {
    assert.equal((await schalte(nutzer, true)).status, 200);
    const a = await anmelden(NUTZER);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal((await rufe('GET', '/profile', { token: a.body.token })).status, 200);
    assert.deepEqual(await protokoll(), ['konto_deaktiviert', 'konto_reaktiviert']);
  });

  await t.test('unconfirmed: the same refusal, new link without account information', async () => {
    const address = `deakt_${process.pid}@example.org`;
    await db.run('UPDATE users SET email = NULL, new_email = $2, registration_pending = true WHERE id = $1', [
      nutzer,
      address,
    ]);
    const a = await anmelden(NUTZER);
    const falsch = await rufe('POST', '/login', { body: { username: NUTZER, password: 'Falsches-Passwort-1' } });
    assert.deepEqual(
      [a.status, a.body],
      [falsch.status, falsch.body],
      'unbestätigt antwortet wie ein falsches Passwort',
    );
    const erneut = email => rufe('POST', '/resend-confirmation', { body: { email } });
    const unbekannt = await erneut(`niemand_${process.pid}@example.org`);
    const bekannt = await erneut(address.toUpperCase());
    assert.deepEqual(
      [bekannt.status, bekannt.body],
      [unbekannt.status, unbekannt.body],
      'die Antwort verrät das Konto',
    );
    assert.equal(bekannt.status, 200);
    const z = await db.get(
      "SELECT new_email_token, new_email_until > NOW() + interval '23 hours' AS frisch FROM users WHERE id = $1",
      [nutzer],
    );
    assert.ok(z.new_email_token && z.frisch, 'kein neuer Link für das unbestätigte Konto');
    await erneut(address);
    assert.equal(
      (await db.get('SELECT new_email_token FROM users WHERE id = $1', [nutzer])).new_email_token,
      z.new_email_token,
      'ein zweiter Link sofort danach',
    );
    await db.run(
      `UPDATE users SET email_verified = true, registration_pending = false, new_email = NULL, new_email_token = NULL,
      new_email_until = NULL WHERE id = $1`,
      [nutzer],
    );
    await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE '%deakt_%'");
  });

  await t.test('the token query checks is_active', async () => {
    const auth = _req('src/account/deviceToken.js');
    const tokenCache = _req('src/account/tokenCache.js');
    const token = await auth.createToken(nutzer, 'Probe');
    assert.ok(await auth.userForToken(token));
    await db.run('UPDATE users SET is_active = false WHERE id = $1', [nutzer]);
    tokenCache.emptyTokenCache();
    assert.equal(await auth.userForToken(token), null);
  });
});
