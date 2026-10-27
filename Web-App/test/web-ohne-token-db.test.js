/**
 * Die Webapp meldet sich nur mit dem httpOnly-Cookie an — ohne Bearer-Token,
 * den ein eingeschleustes Skript aus dem sessionStorage lesen könnte. „Alle
 * anderen abmelden" beendet darum auch die übrigen Browser-Sitzungen.
 *
 * Gegenproben (am 27.10. gemessen):
 *   A  `ohne_token` in POST /login übergangen → rot: „kein Token für den Browser",
 *      dazu die beiden folgenden (die Zählungen stimmen danach nicht mehr)
 *   B  in /sessions/andere-beenden `AND sid <> $2` entfernt → rot: „die eigene
 *      Sitzung bleibt" (die eigene war mit beendet)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const express   = require(path.join(ROOT, 'node_modules', 'express'));
const session   = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt    = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAME = `ohnetoken_${process.pid}`, PASS = 'richtigesPasswort1';

test('Browser ohne Token', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(
    `INSERT INTO users (username, password_hash, is_active, email_verified) VALUES ($1, $2, 1, 1) RETURNING id`,
    [NAME, await bcrypt.hash(PASS, 4)])).id;

  const app = express();
  app.use(express.json());
  app.use(session({
    store: new pgSession({ pool: db.pool, tableName: 'user_sessions' }),
    secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false,
  }));
  app.use('/api/v1/auth', _req('routes/auth.js'));
  app.use('/api/v1/settings', _req('routes/settings.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}/api/v1`;
  t.after(async () => {
    await new Promise(r => srv.close(r));
    await db.run("DELETE FROM user_sessions WHERE sess::jsonb->>'userId' = $1", [String(uid)]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const ruf = async (weg, { method = 'GET', body, cookie } = {}) => {
    const r = await fetch(basis + weg, { method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, cookie: (r.headers.get('set-cookie') || '').split(';')[0], body: await r.json().catch(() => null) };
  };
  const anmelden = (zusatz) => ruf('/auth/login', { method: 'POST', body: { username: NAME, password: PASS, ...zusatz } });
  const tokens = async () => Number((await db.get('SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = $1', [uid])).n);
  const sitzungen = async () => Number((await db.get(
    "SELECT COUNT(*) AS n FROM user_sessions WHERE sess::jsonb->>'userId' = $1", [String(uid)])).n);

  let eigene;
  await t.test('kein Token für den Browser', async () => {
    const r = await anmelden({ ohne_token: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.token, undefined, 'Der Browser bekommt einen Token, den ein Skript lesen könnte');
    assert.equal(await tokens(), 0);
    assert.ok(r.cookie.startsWith('connect.sid='), 'Ohne Token muss die Sitzung tragen');
    eigene = r.cookie;
  });

  await t.test('die App bekommt weiter ihren Token', async () => {
    const r = await anmelden({ label: 'Android App', never_expires: true });
    assert.ok(r.body.token, 'Die App kann ohne Token nichts');
    assert.equal(await tokens(), 1);
  });

  await t.test('die eigene Sitzung bleibt', async () => {
    await anmelden({ ohne_token: true });            // ein zweiter Browser
    assert.equal(await sitzungen(), 3, 'Vorbedingung: drei Sitzungen (zwei Browser und die App-Anmeldung)');
    const r = await ruf('/settings/sessions/andere-beenden', { method: 'POST', cookie: eigene });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.deleted, 2);
    assert.equal(await sitzungen(), 1);
    assert.equal((await ruf('/auth/profile', { cookie: eigene })).status, 200, 'Die eigene Sitzung wurde mit beendet');
  });
});
