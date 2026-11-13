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
 *   C  (02.11.2026) in /sessions/andere-beenden bestaetigePasswort() entfernt
 *      → rot: „die eigene Sitzung bleibt" (200 statt 400 mit falschem Passwort)
 *   D  (03.11.2026) in angemeldetAntworten() die Sitzung wieder auch mit Token
 *      angelegt → rot: „die App bekommt ihren Token und keine Sitzung" (Keks
 *      neben dem Token) und „die eigene Sitzung bleibt" (drei statt zwei)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const db = testDaten();
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAME = `ohnetoken_${process.pid}`,
  PASS = 'richtigesPasswort1';

test('Browser ohne Token', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified) VALUES ($1, $2, true, true) RETURNING id`,
      [NAME, await bcrypt.hash(PASS, 4)],
    )
  ).id;

  const KEKS = _req('src/http/sitzungsKeks.js').sitzungsKeksName();
  const app = express();
  app.use(express.json());
  app.use(
    session({
      store: new pgSession({ pool: db.pool, tableName: 'user_sessions' }),
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      name: KEKS,
    }),
  );
  app.use('/api/v1/auth', require('./helpers/sources').routerAus(_req, 'routes/auth.js'));
  app.use('/api/v1', require('./helpers/sources').routerAus(_req, 'routes/api_v1/settings.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}/api/v1`;
  t.after(async () => {
    await new Promise(r => srv.close(r));
    await db.run("DELETE FROM user_sessions WHERE sess::jsonb->>'userId' = $1", [String(uid)]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const ruf = async (weg, { method = 'GET', body, cookie } = {}) => {
    const r = await fetch(basis + weg, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: r.status,
      cookie: (r.headers.get('set-cookie') || '').split(';')[0],
      body: await r.json().catch(() => null),
    };
  };
  const anmelden = zusatz =>
    ruf('/auth/login', { method: 'POST', body: { username: NAME, password: PASS, ...zusatz } });
  const tokens = async () => Number((await db.get('SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = $1', [uid])).n);
  const sitzungen = async () =>
    Number(
      (await db.get("SELECT COUNT(*) AS n FROM user_sessions WHERE sess::jsonb->>'userId' = $1", [String(uid)])).n,
    );

  let eigene;
  await t.test('kein Token für den Browser', async () => {
    const r = await anmelden({ ohne_token: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.token, undefined, 'Der Browser bekommt einen Token, den ein Skript lesen könnte');
    assert.equal(await tokens(), 0);
    assert.ok(r.cookie.startsWith(`${KEKS}=`), 'Ohne Token muss die Sitzung tragen');
    eigene = r.cookie;
  });

  await t.test('die App bekommt ihren Token und keine Sitzung', async () => {
    const vorher = await sitzungen();
    const r = await anmelden({ label: 'Android App', never_expires: true });
    assert.ok(r.body.token, 'Die App kann ohne Token nichts');
    assert.equal(r.body.token_info?.scope, 'app');
    assert.equal(await tokens(), 1);
    assert.equal(r.cookie, '', 'Neben dem Token ein Sitzungskeks mit den vollen Rechten des Kontos');
    assert.equal(await sitzungen(), vorher, 'Die Token-Anmeldung legt eine Sitzung an');
    const profil = await fetch(basis + '/auth/profile', { headers: { authorization: `Bearer ${r.body.token}` } });
    assert.equal(profil.status, 200, 'Der Token allein trägt die App');
  });

  await t.test('die eigene Sitzung bleibt', async () => {
    await anmelden({ ohne_token: true }); // ein zweiter Browser
    assert.equal(await sitzungen(), 2, 'Vorbedingung: zwei Sitzungen (zwei Browser; die App hat keine)');
    const ohne = await ruf('/settings/sessions/andere-beenden', {
      method: 'POST',
      cookie: eigene,
      body: { password: 'falsch-1234' },
    });
    assert.deepEqual([ohne.status, ohne.body?.code], [400, 'aktuelles_passwort_falsch']);
    assert.equal(await sitzungen(), 2, 'ohne richtiges Passwort wurden Sitzungen beendet');
    const r = await ruf('/settings/sessions/andere-beenden', {
      method: 'POST',
      cookie: eigene,
      body: { password: PASS },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.deleted, 1);
    assert.equal(await sitzungen(), 1);
    assert.equal((await ruf('/auth/profile', { cookie: eigene })).status, 200, 'Die eigene Sitzung wurde mit beendet');
  });
});
