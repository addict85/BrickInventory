/**
 * Eine beendete Sitzung kommt nicht wieder: Auch wenn eine laufende Anfrage
 * die gelöschte Zeile nach dem Rechteentzug per Upsert zurückschreibt, gilt
 * sie nicht mehr (users.sitzungs_version, src/konto/sitzungsVersion.ts).
 * Echter connect-pg-simple-Store, echte Routen, echte Kekse; das Zurückschreiben
 * wird nachgestellt, indem die alte Zeile wieder eingefügt wird.
 *
 * Gegenproben (01.11.2026 gemessen, je einzeln):
 *   A  sitzungsVersionPruefen() ruft immer next() → rot: „die zurückgeschriebene
 *      Verwaltersitzung gilt nicht mehr" und „das andere Fenster bleibt draussen"
 *   B  erhoeheSitzungsVersion() in revokeAllSessions (src/konto/auth.ts) entfernt → rot:
 *      „die zurückgeschriebene Verwaltersitzung gilt nicht mehr"
 *   C  in routes/api_v1/settings.ts die neue Version nicht in die eigene
 *      Sitzung geschrieben → rot: „das eigene Fenster bleibt angemeldet"
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
const express   = require(path.join(ROOT, 'node_modules', 'express'));
const session   = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt    = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAMEN = ['sv_chef', 'sv_zweiter', 'sv_nutzer'];
const PW = 'sitzungsVersion-1';

test('beendete Sitzungen bleiben beendet, auch zurückgeschrieben', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw new Error(`REQUIRE_DB=1, aber keine Test-DB: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  for (const n of NAMEN) await db.run('DELETE FROM users WHERE username = $1', [n]);
  const hash = await bcrypt.hash(PW, 4);
  const id = {};
  for (const [n, admin] of [['sv_chef', true], ['sv_zweiter', true], ['sv_nutzer', false]])
    id[n] = (await db.get('INSERT INTO users (username,password_hash,is_admin,email_verified) VALUES ($1,$2,$3,true) RETURNING id',
      [n, hash, admin])).id;

  const app = express();
  app.use(express.json());
  app.use(session({ store: new pgSession({ pool: db.pool, tableName: 'user_sessions' }),
    secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false }));
  app.use(_req('src/konto/http/sitzungsPruefung.js').sitzungsVersionPruefen());
  app.use('/api/v1', _req('routes/api_v1/middleware.js').anmeldungAmEingang);
  app.use('/api/v1', _req('routes/api_v1/index.js'));
  app.use('/api/v1/auth', _req('routes/auth.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}`;

  const ruf = (pfad, cookie, o = {}) => fetch(basis + pfad, { ...o,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } });
  const anmelden = async (name) => {
    const r = await ruf('/api/v1/auth/login', null, { method: 'POST', body: JSON.stringify({ username: name, password: PW, ohne_token: true }) });
    assert.equal(r.status, 200, await r.text());
    return (r.headers.get('set-cookie') || '').split(';')[0];
  };
  const sid = (cookie) => decodeURIComponent(cookie.split('=')[1]).slice(2).split('.')[0];
  const zeile = async (cookie) => db.get('SELECT sid, sess, expire FROM user_sessions WHERE sid = $1', [sid(cookie)]);
  // Was eine Anfrage tut, die vor dem Löschen begann und danach speichert.
  const zurueckschreiben = (z) => db.run(
    'INSERT INTO user_sessions (sid, sess, expire) VALUES ($1,$2,$3) ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess',
    [z.sid, z.sess, z.expire]);
  const angemeldet = async (cookie) => (await (await ruf('/api/v1/auth/me', cookie)).json()).loggedIn === true;

  try {
    await t.test('Rechteentzug: die zurückgeschriebene Verwaltersitzung gilt nicht mehr', async () => {
      const chef = await anmelden('sv_chef');
      const zweiter = await anmelden('sv_zweiter');
      assert.equal((await ruf('/api/v1/auth/users', zweiter)).status, 200, 'Vorbedingung: Verwalter');
      const alt = await zeile(zweiter);
      assert.ok(alt, 'Vorbedingung: Sitzungszeile liegt');

      const r = await ruf(`/api/v1/auth/users/${id.sv_zweiter}/admin`, chef,
        { method: 'PUT', body: JSON.stringify({ is_admin: false, admin_password: PW }) });
      assert.equal(r.status, 200, await r.text());
      assert.equal(await zeile(zweiter), undefined, 'Vorbedingung: Zeile gelöscht');
      await zurueckschreiben(alt);

      const danach = await ruf('/api/v1/auth/users', zweiter);
      assert.equal(danach.status, 401, 'die zurückgeschriebene Verwaltersitzung gilt nicht mehr');
      assert.equal(await angemeldet(zweiter), false);
      assert.equal(await zeile(zweiter), undefined, 'die alte Zeile ist beim Abweisen wieder entfernt');
      assert.equal(await angemeldet(await anmelden('sv_zweiter')), true, 'neu anmelden geht');
    });

    await t.test('andere Fenster beenden: das eigene bleibt, das andere bleibt draussen', async () => {
      const a = await anmelden('sv_nutzer');
      const b = await anmelden('sv_nutzer');
      const altB = await zeile(b);
      const r = await ruf('/api/v1/settings/sessions/andere-beenden', a, { method: 'POST', body: JSON.stringify({ password: PW }) });
      assert.equal(r.status, 200, await r.text());
      await zurueckschreiben(altB);
      assert.equal(await angemeldet(b), false, 'das andere Fenster bleibt draussen');
      assert.equal(await angemeldet(a), true, 'das eigene Fenster bleibt angemeldet');
      assert.equal((await ruf('/api/v1/settings/tokens', a)).status, 200, 'das eigene Fenster arbeitet weiter');
    });
  } finally {
    srv.close();
    for (const n of NAMEN) await db.run('DELETE FROM users WHERE username = $1', [n]).catch(() => {});
    await db.pool.end();
  }
});
