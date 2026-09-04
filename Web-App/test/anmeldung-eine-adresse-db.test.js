/**
 * Die EINE Anmeldung — durchgespielt, nicht gelesen.
 *
 * ── Warum es diese Datei gibt ───────────────────────────────────────────────
 * Es gab zwei Anmeldungen: /api/auth/login stellte eine Sitzung aus,
 * /api/v1/auth/login einen Bearer-Token. Sie sind zusammengelegt; beide
 * Clients rufen jetzt dieselbe Adresse.
 *
 * Genau dieser Umbau ist der, bei dem ein Fehler NICHT „ein Diagramm fehlt"
 * heisst, sondern „niemand kommt mehr rein". Ein quelltextlesender Test kann
 * das nicht beantworten: Er sieht, dass eine Zeile dasteht, nicht dass sie
 * wirkt. Deshalb hier ein echter Server mit echtem Sitzungs-Store, echten
 * Cookies und echten Token — und die Verdrahtung wird aus server.ts GELESEN
 * (einhaengung()), damit der Prüfstand nicht seine eigene Adresse prüft.
 *
 * ── Was durchgespielt wird ──────────────────────────────────────────────────
 *  1. Browser meldet sich an  -> Cookie UND Token, Token mit Ablaufdatum
 *  2. App meldet sich an      -> Token OHNE Ablaufdatum (never_expires)
 *  3. /me mit Cookie, mit Token, ohne alles, mit ungültigem Token
 *  4. Abmelden entwertet BEIDES — Sitzung und Token, in einem Aufruf
 *
 * Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
 * Ohne DB: skip. Ausführen: REQUIRE_DB=1 npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const _req = require('./helpers/sources').buildAndRequire();
const AUTH = require('./helpers/sources').einhaengung('auth');
const db = _req('db/database.js');
const express   = require(path.join(ROOT, 'node_modules', 'express'));
const session   = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt    = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAME = 'eine_anmeldung', PASS = 'richtigesPasswort1';

test('eine Adresse, zwei Ausweise — durchgespielt', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  // Wenige Runden: Hier wird die VERDRAHTUNG geprüft, nicht die Laufzeit —
  // die misst test/login-zeitgleich-db.test.js, und dort sind die echten
  // Kosten Teil der Aussage.
  await db.run(
    'INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,1,1,1)',
    [NAME, await bcrypt.hash(PASS, 4)]);
  const uid = (await db.get('SELECT id FROM users WHERE username=$1', [NAME])).id;

  const app = express();
  app.use(express.json());
  app.use(session({
    store: new pgSession({ pool: db.pool, tableName: 'user_sessions' }),
    secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false,
  }));
  app.use(AUTH, _req('routes/auth.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}${AUTH}`;

  const ruf = async (weg, opt = {}) => {
    const r = await fetch(basis + weg, {
      method: opt.method || 'GET',
      headers: { 'content-type': 'application/json', ...(opt.headers || {}) },
      ...(opt.body ? { body: JSON.stringify(opt.body) } : {}),
    });
    return { status: r.status, cookie: r.headers.get('set-cookie'), body: await r.json().catch(() => null) };
  };
  const ablauf = async (token) => db.get(
    'SELECT expires_at FROM api_tokens WHERE token = $1',
    [_req('utils/auth.js').hashToken(token)]);

  try {
    // ── 1. Der Browser: kein never_expires ──────────────────────────────────
    const web = await ruf('/login', { method: 'POST', body: { username: NAME, password: PASS } });
    assert.equal(web.status, 200, `Anmeldung scheiterte: ${JSON.stringify(web.body)}`);
    assert.equal(web.body.success, true);
    assert.ok(web.cookie, 'Ohne Set-Cookie gibt es keine Sitzung — der Browser wäre nicht angemeldet');
    assert.ok(web.body.token, 'Ohne Token kann EventSource sich nicht ausweisen');
    assert.equal(web.body.never_expires, false);
    assert.equal(web.body.user.is_admin, true, 'Die App liest is_admin — das Feld muss da sein');
    const webCookie = web.cookie.split(';')[0];
    const webToken  = web.body.token;
    assert.ok((await ablauf(webToken))?.expires_at,
      'Der Token des Browsers muss ein Ablaufdatum haben — er liegt im sessionStorage');

    // ── 2. Die App: never_expires ───────────────────────────────────────────
    const app1 = await ruf('/login', { method: 'POST',
      body: { username: NAME, password: PASS, label: 'Android App', never_expires: true } });
    assert.equal(app1.status, 200, `Anmeldung der App scheiterte: ${JSON.stringify(app1.body)}`);
    assert.equal(app1.body.never_expires, true,
      'Die Antwort muss bestaetigen, dass der Token dauerhaft ist — die App verlangt das mit never_expires');
    const appToken = app1.body.token;
    assert.equal((await ablauf(appToken)).expires_at, null,
      'Der Token der App darf kein Ablaufdatum haben — sonst muss man wöchentlich neu tippen');
    // Vorbedingung: Es sind zwei VERSCHIEDENE Token, sonst prüft der Rest nichts.
    assert.notEqual(webToken, appToken);

    // ── 3. Wer bin ich? ─────────────────────────────────────────────────────
    const mitCookie = await ruf('/me', { headers: { cookie: webCookie } });
    assert.equal(mitCookie.status, 200);
    assert.equal(mitCookie.body.loggedIn, true, 'Die Sitzung des Browsers wird nicht erkannt');
    assert.equal(mitCookie.body.user.id, uid);

    const mitToken = await ruf('/me', { headers: { authorization: `Bearer ${appToken}` } });
    assert.equal(mitToken.status, 200);
    assert.equal(mitToken.body.loggedIn, true, 'Der Token der App wird nicht erkannt');
    assert.equal(mitToken.body.user.is_admin, true);

    // Ohne alles: 200 und „nein". Der Browser fragt das VOR jeder Anmeldung —
    // ein 401 wäre dort die normale Antwort auf eine normale Frage.
    const ohne = await ruf('/me');
    assert.equal(ohne.status, 200, 'Ohne Ausweis ist „nicht angemeldet" keine Störung');
    assert.equal(ohne.body.loggedIn, false);

    // Mit einem Token, den es nicht gibt: 401. Der Interceptor der App macht
    // daraus „Sitzung abgelaufen" und führt zurück zur Anmeldung
    // (RepoBasis.kt). Bei 200 bliebe sie mit einem toten Token stehen.
    const falsch = await ruf('/me', { headers: { authorization: 'Bearer ' + 'f'.repeat(64) } });
    assert.equal(falsch.status, 401,
      'Ein vorgelegter, ungültiger Token muss 401 ergeben — sonst merkt die App den Ablauf nicht');

    // ── 4. Abmelden entwertet BEIDES ────────────────────────────────────────
    const ab = await ruf('/logout', { method: 'POST',
      headers: { cookie: webCookie, authorization: `Bearer ${webToken}` } });
    assert.equal(ab.status, 200);
    assert.equal(await ablauf(webToken), undefined,
      'Der Token muss beim Abmelden verschwinden — er überlebte sonst sieben Tage im sessionStorage');
    const danach = await ruf('/me', { headers: { cookie: webCookie } });
    assert.equal(danach.body.loggedIn, false, 'Die Sitzung muss beim Abmelden enden');
    // Der Token der App ist davon NICHT betroffen — abgemeldet hat sich der Browser.
    const appNoch = await ruf('/me', { headers: { authorization: `Bearer ${appToken}` } });
    assert.equal(appNoch.body.loggedIn, true,
      'Das Abmelden im Browser darf das Telefon nicht mit abmelden');

    // ── 5. Falsches Passwort bleibt falsch ──────────────────────────────────
    const daneben = await ruf('/login', { method: 'POST', body: { username: NAME, password: 'falsch' } });
    assert.equal(daneben.status, 401);
    assert.equal(daneben.body.token, undefined, 'Ein fehlgeschlagener Login darf keinen Token ausgeben');
  } finally {
    await new Promise(r => srv.close(r));
    await db.run('DELETE FROM users WHERE username = $1', [NAME]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
