/**
 * An ended session does not come back: even if a running request
 * writes the deleted row back via upsert after the revocation of rights, it
 * no longer applies (users.session_version, src/account/sessionVersion.ts).
 * Real connect-pg-simple store, real routes, real cookies; the writing back
 * is recreated by inserting the old row again.
 *
 * Counter-checks (measured 01.11.2026, each on its own):
 *   A  checkSessionVersion() always calls next() → red: „die zurückgeschriebene
 *      Verwaltersitzung gilt nicht mehr" and „das andere Fenster bleibt draussen"
 *   B  increaseSessionVersion() removed in endAllSessions (src/account/accessEnd.ts) → red:
 *      „die zurückgeschriebene Verwaltersitzung gilt nicht mehr"
 *   C  in routes/api/settings.ts the new version not written into the own
 *      session → red: „das eigene Fenster bleibt angemeldet"
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

const NAMEN = ['sv_chef', 'sv_second', 'sv_nutzer'];
const PW = 'sitzungsVersion-1';

test('ended sessions stay ended, even when written back', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  for (const n of NAMEN) await db.run('DELETE FROM users WHERE username = $1', [n]);
  const hash = await bcrypt.hash(PW, 4);
  const id = {};
  for (const [n, admin] of [
    ['sv_chef', true],
    ['sv_second', true],
    ['sv_nutzer', false],
  ])
    id[n] = (
      await db.get(
        'INSERT INTO users (username,password_hash,is_admin,email_verified) VALUES ($1,$2,$3,true) RETURNING id',
        [n, hash, admin],
      )
    ).id;
  // Admins need a code generator; login and confirmation each take a recovery code.
  const { adminWithFactor } = require('./helpers/admin');
  const codes = {
    sv_chef: await adminWithFactor(_req, id.sv_chef),
    sv_second: await adminWithFactor(_req, id.sv_second),
  };

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
    _req('src/account/http/sessionCheck.js').checkSessionVersion(require('./helpers/sources').testServices().account),
  );
  app.use(
    '/api/v2',
    _req('routes/api/middleware.js').guardFor(require('./helpers/sources').testServices().account).loginAtInbox,
  );
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2', require('./helpers/sources').routerFrom(_req, 'routes/api/index.js'));
  app.use('/api/v2/auth', require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}`;

  const callFn = (path, cookie, o = {}) =>
    fetch(basis + path, { ...o, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } });
  const anmelden = async name => {
    const r = await callFn('/api/v2/auth/login', null, {
      method: 'POST',
      body: JSON.stringify({ username: name, password: PW, without_token: true, code: codes[name]?.shift() }),
    });
    assert.equal(r.status, 200, await r.text());
    return (r.headers.get('set-cookie') || '').split(';')[0];
  };
  // The table holds the hash of the id from the cookie (src/account/sessionStore.ts).
  const sid = cookie =>
    _req('src/account/sessionStore.js').sessionDigest(decodeURIComponent(cookie.split('=')[1]).slice(2).split('.')[0]);
  const row = async cookie => db.get('SELECT sid, sess, expire FROM user_sessions WHERE sid = $1', [sid(cookie)]);
  // What a request does that began before the deletion and saves afterwards.
  const writeBack = z =>
    db.run(
      'INSERT INTO user_sessions (sid, sess, expire) VALUES ($1,$2,$3) ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess',
      [z.sid, z.sess, z.expire],
    );
  const angemeldet = async cookie => (await (await callFn('/api/v2/auth/me', cookie)).json()).loggedIn === true;

  try {
    await t.test('revocation of rights: the written-back administrator session no longer applies', async () => {
      const chef = await anmelden('sv_chef');
      const zweiter = await anmelden('sv_second');
      assert.equal((await callFn('/api/v2/auth/users', zweiter)).status, 200, 'Vorbedingung: Verwalter');
      const alt = await row(zweiter);
      assert.ok(alt, 'Vorbedingung: Sitzungszeile liegt');

      const r = await callFn(`/api/v2/auth/users/${id.sv_second}/admin`, chef, {
        method: 'PUT',
        body: JSON.stringify({ is_admin: false, admin_password: PW, code: codes.sv_chef.shift() }),
      });
      assert.equal(r.status, 200, await r.text());
      // An admin's role is only revoked after the period: make it due and execute.
      await db.run(`UPDATE admin_takeovers SET effective_at = NOW() - INTERVAL '1 minute' WHERE target_id = $1`, [
        id.sv_second,
      ]);
      assert.equal(await _req('src/account/adminActions.js').runDueTakeoversFrom(), 1);
      assert.equal(await row(zweiter), undefined, 'Vorbedingung: Zeile gelöscht');
      await writeBack(alt);

      const danach = await callFn('/api/v2/auth/users', zweiter);
      assert.equal(danach.status, 401, 'die zurückgeschriebene Verwaltersitzung gilt nicht mehr');
      assert.equal(await angemeldet(zweiter), false);
      assert.equal(await row(zweiter), undefined, 'die alte Zeile ist beim Abweisen wieder entfernt');
      assert.equal(await angemeldet(await anmelden('sv_second')), true, 'neu anmelden geht');
    });

    await t.test('end other windows: the own one stays, the other stays out', async () => {
      const a = await anmelden('sv_nutzer');
      const b = await anmelden('sv_nutzer');
      const altB = await row(b);
      const r = await callFn('/api/v2/settings/sessions/end-others', a, {
        method: 'POST',
        body: JSON.stringify({ password: PW }),
      });
      assert.equal(r.status, 200, await r.text());
      await writeBack(altB);
      assert.equal(await angemeldet(b), false, 'das andere Fenster bleibt draussen');
      assert.equal(await angemeldet(a), true, 'das eigene Fenster bleibt angemeldet');
      assert.equal((await callFn('/api/v2/settings/tokens', a)).status, 200, 'das eigene Fenster arbeitet weiter');
    });
  } finally {
    srv.close();
    for (const n of NAMEN) await db.run('DELETE FROM users WHERE username = $1', [n]).catch(() => {});
    await db.pool.end();
  }
});
