/**
 * Mit dem Startpasswort (must_change_password) lässt der Server nur den
 * Wechsel zu — für Sitzung und App-Token, nicht nur in der Oberfläche.
 *
 * Gegenproben (01.11.2026 gemessen):
 *   A  die Prüfung in anmeldungAmEingang entfernt → rot: „Sitzung kommt am
 *      Wechsel vorbei“ und „Token kommt am Wechsel vorbei“
 *   B  mussWechseln() liest nur das Sitzungsfeld (ohne Rückfall auf die
 *      Datenbank) → rot: „eine Sitzung von vor dem Feld …“
 *   C  change-password nicht mehr in VOR_DEM_WECHSEL → rot: „der Wechsel selbst geht“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAME = `pflicht_${process.pid}`, PASS = 'start-Passwort-1', NEU = 'eigenes-Passwort-2';

test('Startpasswort: erst wechseln, dann alles andere', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash, is_admin, is_active, email_verified, must_change_password)
    VALUES ($1, $2, true, true, true, true) RETURNING id`, [NAME, await bcrypt.hash(PASS, 4)])).id;

  const app = express();
  app.use(express.json());
  app.use(session({ store: new pgSession({ pool: db.pool, tableName: 'user_sessions' }),
    secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false }));
  app.use('/api/v1', _req('routes/api_v1/middleware.js').anmeldungAmEingang);
  app.use('/api/v1', _req('routes/api_v1/index.js'));
  app.use('/api/v1/auth', _req('routes/auth.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}/api/v1`;
  t.after(async () => {
    await new Promise(r => srv.close(r));
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', [`%konto:${uid}%`]);
    await db.pool.end().catch(() => {});
  });
  const ruf = async (weg, { body, cookie, token } = {}) => {
    const r = await fetch(basis + weg, { method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}),
                 ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, cookie: r.headers.get('set-cookie')?.split(';')[0], body: await r.json().catch(() => null) };
  };

  const anmeldung = await ruf('/auth/login', { body: { username: NAME, password: PASS } });
  assert.equal(anmeldung.status, 200, JSON.stringify(anmeldung.body));
  assert.equal(anmeldung.body.user.mustChangePassword, true);
  const { body: { token } } = anmeldung;
  const { cookie } = await ruf('/auth/login', { body: { username: NAME, password: PASS, ohne_token: true } });

  await t.test('Sitzung und Token kommen nur bis zum Wechsel', async () => {
    const s = await ruf('/settings/tokens', { cookie });
    assert.equal(s.status, 403, 'Sitzung kommt am Wechsel vorbei');
    assert.equal(s.body.code, 'passwort_wechsel_noetig');
    const k = await ruf('/settings/tokens', { token });
    assert.equal(k.status, 403, 'Token kommt am Wechsel vorbei');
    const ich = await ruf('/auth/me', { cookie });
    assert.equal(ich.status, 200);
    assert.equal(ich.body.user.mustChangePassword, true, '/me sagt der Oberfläche nichts vom Wechsel');
  });

  await t.test('eine Sitzung von vor dem Feld fragt die Datenbank', async () => {
    const sid = decodeURIComponent(cookie.split('=')[1]).slice(2).split('.')[0];
    await db.run(`UPDATE user_sessions SET sess = (sess::jsonb - 'mussPasswortAendern')::json WHERE sid = $1`, [sid]);
    assert.equal((await ruf('/settings/tokens', { cookie })).status, 403);
  });

  await t.test('der Wechsel selbst geht, danach alles', async () => {
    const w = await ruf('/auth/change-password', { cookie, body: { current: PASS, newPassword: NEU } });
    assert.equal(w.status, 200, JSON.stringify(w.body));
    const neu = w.cookie ?? cookie;
    assert.equal((await ruf('/settings/tokens', { cookie: neu })).status, 200);
    assert.equal((await ruf('/auth/me', { cookie: neu })).body.user.mustChangePassword, false);
  });
});
