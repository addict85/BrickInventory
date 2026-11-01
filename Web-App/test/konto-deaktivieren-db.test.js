/**
 * Ein Verwalter deaktiviert ein fremdes Konto: Token und Sitzung gelten sofort
 * nicht mehr (nicht erst nach den 60 s des Token-Caches), die Anmeldung ist
 * gesperrt, beides steht im Protokoll; nach dem Reaktivieren geht die
 * Anmeldung wieder. Die Token-Abfrage selbst prüft is_active.
 *
 * Gegenproben (01.11.2026 gemessen):
 *   A  in setzeAktiv() zugaengeBeenden() weggelassen → rot: „Token und Sitzung
 *      gelten sofort nicht mehr" („Token gilt weiter": 200 aus dem Cache)
 *   B  `AND u.is_active` in gueltigerToken() entfernt → rot: „die Token-Abfrage
 *      prüft is_active"
 *   C  die Prüfung auf das eigene Konto entfernt → rot: „nicht das eigene
 *      Konto" (200; der Verwalter sperrte sich aus, die Fälle danach folgen)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

test('Konto deaktivieren und reaktivieren', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }

  const CHEF = `deakt_chef_${process.pid}`, NUTZER = `deakt_nutzer_${process.pid}`, PASS = 'Deakt-Passwort-1';
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[CHEF, NUTZER]]);
  const lege = async (name, admin) => (await db.get(`INSERT INTO users (username, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`, [name, bcrypt.hashSync(PASS, 4), admin])).id;
  const chef = await lege(CHEF, true), nutzer = await lege(NUTZER, false);
  await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE '%deakt_%'");
  t.after(async () => {
    await db.run('DELETE FROM verwaltungsprotokoll WHERE ziel_id = ANY($1)', [[chef, nutzer]]);
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[chef, nutzer]]);
    await db.pool.end().catch(() => {});
  });

  const app = express();
  app.use(express.json());
  app.use(session({ store: new pgSession({ pool: db.pool, tableName: 'user_sessions' }),
    secret: 'deaktivieren-test-geheimnis-lang-genug', resave: false, saveUninitialized: false }));
  app.use('/api/v1', _req('routes/api_v1/middleware.js').anmeldungAmEingang);
  app.use('/api/v1/auth', _req('routes/auth.js'));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const rufe = (methode, pfad, { body, cookie, token } = {}) => fetch(`http://127.0.0.1:${srv.address().port}/api/v1/auth${pfad}`, {
    method: methode, body: body && JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}),
               ...(token ? { authorization: `Bearer ${token}` } : {}) },
  }).then(async r => ({ status: r.status, cookie: (r.headers.get('set-cookie') || '').split(';')[0], body: await r.json() }));
  const anmelden = (name, body = {}) => rufe('POST', '/login', { body: { username: name, password: PASS, ...body } });
  const schalte = (id, aktiv, pw = PASS) => rufe('PUT', `/users/${id}/aktiv`,
    { cookie: chefKeks, body: { is_active: aktiv, admin_password: pw } });
  const protokoll = async () => (await db.all(
    'SELECT aktion FROM verwaltungsprotokoll WHERE ziel_id = $1 ORDER BY id', [nutzer])).map(z => z.aktion);

  const chefKeks = (await anmelden(CHEF, { ohne_token: true })).cookie;
  assert.match(chefKeks, /^connect\.sid=/);

  await t.test('Token und Sitzung gelten sofort nicht mehr', async () => {
    const a = await anmelden(NUTZER);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal((await rufe('GET', '/profile', { token: a.body.token })).status, 200);
    assert.equal((await rufe('GET', '/profile', { cookie: a.cookie })).status, 200);

    const r = await schalte(nutzer, false);
    assert.deepEqual([r.status, r.body], [200, { success: true, is_active: false }]);
    assert.equal((await rufe('GET', '/profile', { token: a.body.token })).status, 401, 'Token gilt weiter');
    assert.equal((await rufe('GET', '/profile', { cookie: a.cookie })).status, 401, 'Sitzung gilt weiter');
    assert.equal((await db.get('SELECT count(*)::int n FROM api_tokens WHERE user_id = $1', [nutzer])).n, 0);
  });

  await t.test('die Anmeldung ist gesperrt, die Liste zeigt es, das Protokoll nennt es', async () => {
    const a = await anmelden(NUTZER);
    assert.deepEqual([a.status, a.body.code], [403, 'konto_deaktiviert']);
    const liste = (await rufe('GET', '/users', { cookie: chefKeks })).body.users;
    assert.equal(liste.find(u => u.id === nutzer).is_active, false);
    assert.equal(liste.find(u => u.id === chef).is_active, true);
    assert.deepEqual(await protokoll(), ['konto_deaktiviert']);
  });

  await t.test('ohne Passwort des Verwalters ändert sich nichts', async () => {
    const r = await schalte(nutzer, true, 'falsch');
    assert.equal(r.status, 400);
    assert.equal((await db.get('SELECT is_active FROM users WHERE id = $1', [nutzer])).is_active, false);
  });

  await t.test('nicht das eigene Konto', async () => {
    const r = await schalte(chef, false);
    assert.deepEqual([r.status, r.body.code], [400, 'eigenes_konto_deaktivieren']);
    assert.equal((await db.get('SELECT is_active FROM users WHERE id = $1', [chef])).is_active, true);
  });

  await t.test('reaktiviert meldet sich das Konto wieder an', async () => {
    assert.equal((await schalte(nutzer, true)).status, 200);
    const a = await anmelden(NUTZER);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal((await rufe('GET', '/profile', { token: a.body.token })).status, 200);
    assert.deepEqual(await protokoll(), ['konto_deaktiviert', 'konto_reaktiviert']);
  });

  await t.test('die Token-Abfrage prüft is_active', async () => {
    const auth = _req('src/konto/auth.js');
    const token = await auth.createToken(nutzer, 'Probe');
    assert.ok(await auth.validateToken(token));
    await db.run('UPDATE users SET is_active = false WHERE id = $1', [nutzer]);
    auth.leereTokenCache();
    assert.equal(await auth.validateToken(token), null);
  });
});
