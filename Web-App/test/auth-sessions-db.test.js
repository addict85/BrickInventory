/**
 * Passwortwechsel gegen echte Datenbank und echten Session-Store.
 *
 * ── Warum es diese Datei gibt ───────────────────────────────────────────────
 * Die Regel „ein Passwortwechsel beendet alle offenen Zugänge" war bisher NUR
 * über Quelltext-Prüfungen abgesichert (auth-parity.test.js). Genau diese Sorte
 * Test hatte die Lücke davor FESTGESCHRIEBEN statt gefunden: Er verlangte
 * ausdrücklich einen Test auf `to_regclass('public.session')` — eine Tabelle,
 * die es nie gab, weil der Store auf `user_sessions` läuft. Der Ausdruck stand
 * im Code, der Test war grün, und das DELETE lief nie. Ein Administrator konnte
 * das Passwort eines übernommenen Kontos zurücksetzen, während die Sitzung des
 * Angreifers weiterlief.
 *
 * Eine Quelltext-Prüfung kann das nicht merken — sie sieht Zeichen, kein
 * Verhalten. Deshalb hier: echter connect-pg-simple-Store, echte Routen, echte
 * Cookies. Die statischen Prüfungen bleiben daneben bestehen; sie erklären die
 * Regel und fangen ein versehentliches Löschen des Aufrufs. Aber ob sie WIRKT,
 * beantwortet nur diese Datei.
 *
 * Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
 * Ohne DB: skip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const express     = require(path.join(ROOT, 'node_modules', 'express'));
const session     = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession   = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt      = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

test('ein Passwortwechsel beendet Sitzungen UND Token — gegen echten Store',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  // ── Aufbau: ein Administrator, ein Opfer ────────────────────────────────
  for (const name of ['pw_chef', 'pw_opfer']) {
    await db.run('DELETE FROM users WHERE username = $1', [name]);
  }
  const hash = await bcrypt.hash('altesPasswort1', 4);
  await db.run(
    "INSERT INTO users (username,password_hash,is_admin,email_verified) VALUES ($1,$2,1,1)",
    ['pw_chef', hash]);
  await db.run(
    "INSERT INTO users (username,password_hash,is_admin,email_verified) VALUES ($1,$2,0,1)",
    ['pw_opfer', hash]);
  const opferId = (await db.get("SELECT id FROM users WHERE username='pw_opfer'")).id;

  const app = express();
  app.use(express.json());
  app.use(session({
    store: new pgSession({ pool: db.pool, tableName: 'user_sessions' }),
    secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false,
  }));
  app.use('/api/auth', _req('routes/auth.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}`;

  // Passwort als Parameter, NICHT fest verdrahtet: Der zweite Subtest ändert
  // das Passwort des Administrators — mit einem festen 'altesPasswort1' scheitert
  // die nächste Anmeldung, und der dritte Subtest wäre aus einem Grund rot, der
  // nichts mit der geprüften Regel zu tun hat.
  const anmelden = async (user, passwort) => {
    const r = await fetch(`${basis}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: user, password: passwort }),
    });
    const body = await r.json();
    assert.equal(body.success, true, `Anmeldung ${user} fehlgeschlagen: ${JSON.stringify(body)}`);
    return { cookie: (r.headers.get('set-cookie') || '').split(';')[0], body };
  };
  const angemeldet = async (cookie) =>
    (await fetch(`${basis}/api/auth/me`, { headers: { cookie } }).then(r => r.json())).loggedIn === true;
  const sitzungen = async (uid) => (await db.get(
    "SELECT COUNT(*)::int n FROM user_sessions WHERE sess::jsonb->>'userId' = $1", [String(uid)])).n;

  try {
    await t.test('der Admin-Reset wirft das übernommene Fenster hinaus', async () => {
      const angreifer = await anmelden('pw_opfer', 'altesPasswort1');
      const chef      = await anmelden('pw_chef',  'altesPasswort1');
      assert.equal(await angemeldet(angreifer.cookie), true, 'Vorbedingung: Sitzung steht');
      assert.ok(await sitzungen(opferId) >= 1, 'Vorbedingung: Sitzung liegt in user_sessions');

      const r = await fetch(`${basis}/api/auth/users/${opferId}/password`, {
        method: 'PUT', headers: { 'content-type': 'application/json', cookie: chef.cookie },
        body: JSON.stringify({ password: 'neuesPasswort1' }),
      });
      assert.equal(r.status, 200, await r.text());

      // DER Punkt der Datei: Sitzung ist wirklich weg, nicht nur „das DELETE
      // steht im Code".
      assert.equal(await sitzungen(opferId), 0, 'Sitzungen des Kontos müssen enden');
      assert.equal(await angemeldet(angreifer.cookie), false,
        'Das alte Fenster darf nach dem Reset nicht weiter angemeldet sein');
    });

    await t.test('der eigene Passwortwechsel wirft die anderen Fenster hinaus — nicht das eigene', async () => {
      // Zwei Fenster desselben Kontos: eines wechselt das Passwort, das andere
      // muss draussen sein. Das wechselnde Fenster bleibt drin (frische
      // Session-ID über establishSession) — sonst flöge man sich selbst raus.
      const fensterA = await anmelden('pw_chef', 'altesPasswort1');
      const fensterB = await anmelden('pw_chef', 'altesPasswort1');
      assert.equal(await angemeldet(fensterB.cookie), true, 'Vorbedingung: zweites Fenster offen');

      const r = await fetch(`${basis}/api/auth/change-password`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie: fensterA.cookie },
        body: JSON.stringify({ current: 'altesPasswort1', newPassword: 'nochNeuer12' }),
      });
      assert.equal(r.status, 200, await r.text());

      assert.equal(await angemeldet(fensterB.cookie), false,
        'Das andere Fenster muss nach dem Passwortwechsel abgemeldet sein');
      // Das eigene Fenster: Die Session-ID wurde erneuert, das alte Cookie ist
      // damit ebenfalls entwertet — erwünscht (Session Fixation) und der Grund,
      // warum die Antwort ein neues Cookie mitschickt.
      assert.ok(r.headers.get('set-cookie'),
        'Nach der Rotation muss ein neues Sitzungs-Cookie zurückkommen');
    });

    await t.test('Bearer-Token des Kontos verfallen mit', async () => {
      const { hashToken, validateToken } = _req('utils/auth.js');
      const crypto = require('node:crypto');
      const tok = crypto.randomBytes(16).toString('hex');
      await db.run(
        "INSERT INTO api_tokens (token,user_id,label,expires_at) VALUES ($1,$2,'app',NULL)",
        [hashToken(tok), opferId]);
      assert.ok(await validateToken(tok), 'Vorbedingung: Token gilt');

      // 'nochNeuer12' — der Subtest davor hat es geändert.
      const chef = await anmelden('pw_chef', 'nochNeuer12');
      // Das Passwort des OPFERS wurde im ersten Subtest geändert — hier zählt nur, dass
      // der Reset läuft; der Admin-Weg verlangt kein altes Passwort.
      const r = await fetch(`${basis}/api/auth/users/${opferId}/password`, {
        method: 'PUT', headers: { 'content-type': 'application/json', cookie: chef.cookie },
        body: JSON.stringify({ password: 'wiederNeu123' }),
      });
      assert.equal(r.status, 200, await r.text());
      assert.equal(await validateToken(tok), null,
        'Ein Token auf einem fremden Gerät darf den Passwortwechsel nicht überleben');
    });
  } finally {
    srv.close();
    for (const name of ['pw_chef', 'pw_opfer']) {
      await db.run('DELETE FROM users WHERE username = $1', [name]).catch(() => {});
    }
    await db.pool.end();
  }
});
