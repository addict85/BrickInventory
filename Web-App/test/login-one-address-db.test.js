/**
 * The ONE login — played through, not read.
 *
 * Counter-check (14.11.2026): in POST /logout again `tokenLoeschen(…).catch(logAndContinue(…))`
 * → red: „Ein Token, der gültig bleibt, darf nicht als abgemeldet gelten“ (200 instead of 500).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const AUTH = require('./helpers/sources').einhaengung('auth');
const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAME = 'eine_anmeldung',
  PASS = 'richtigesPasswort1';

test('one address, two credentials — played through', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  // Few rounds: here the WIRING is checked, not the run time —
  // that is measured by test/login-time-equal-db.test.js, and there the real
  // costs are part of the statement.
  await db.run(
    'INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,true,true,true)',
    [NAME, await bcrypt.hash(PASS, 4)],
  );
  const uid = (await db.get('SELECT id FROM users WHERE username=$1', [NAME])).id;

  const app = express();
  app.use(express.json());
  app.use(
    session({
      store: new pgSession({ pool: db.pool, tableName: 'user_sessions' }),
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
    }),
  );
  app.use(AUTH, require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
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
  const ablauf = async token =>
    db.get('SELECT expires_at FROM api_tokens WHERE token = $1', [
      _req('src/account/deviceToken.js').tokenDigest(token),
    ]);

  try {
    // ── 1. Without never_expires: a token with seven fixed days, no cookie ──
    const kurz = await ruf('/login', { method: 'POST', body: { username: NAME, password: PASS } });
    assert.equal(kurz.status, 200, `Anmeldung scheiterte: ${JSON.stringify(kurz.body)}`);
    assert.equal(kurz.body.success, true);
    assert.equal(kurz.cookie, null, 'Ein Login mit Token trägt keinen Sitzungskeks');
    assert.ok(kurz.body.token);
    assert.equal(kurz.body.never_expires, false);
    assert.equal(kurz.body.user.is_admin, true, 'Die App liest is_admin — das Feld muss da sein');
    const webToken = kurz.body.token;
    assert.ok((await ablauf(webToken))?.expires_at, 'Der kurze Token muss ein Ablaufdatum haben');
    // The browser: only the session.
    const web = await ruf('/login', { method: 'POST', body: { username: NAME, password: PASS, ohne_token: true } });
    assert.ok(web.cookie, 'Ohne Set-Cookie gibt es keine Sitzung — der Browser wäre nicht angemeldet');
    assert.equal(web.body.token, undefined);
    const webCookie = web.cookie.split(';')[0];

    // 2. The app: sliding deadline instead of none at all
    const app1 = await ruf('/login', {
      method: 'POST',
      // Scope `voll`: a token only gets admin rights on explicit request.
      body: { username: NAME, password: PASS, label: 'Android App', never_expires: true, scope: 'voll' },
    });
    assert.equal(app1.status, 200, `Anmeldung der App scheiterte: ${JSON.stringify(app1.body)}`);
    assert.equal(
      app1.body.never_expires,
      false,
      'Bei eingeschalteter Gleitfrist ist kein Token „ohne Ablauf" — die Antwort darf das nicht behaupten',
    );
    const appToken = app1.body.token;
    const appRow = await db.get('SELECT expires_at, sliding FROM api_tokens WHERE token = $1', [
      _req('src/account/deviceToken.js').tokenDigest(appToken),
    ]);
    assert.ok(
      appRow.expires_at,
      'Der Token der App braucht ein echtes Ablaufdatum — sonst haengt die Frist an einem Hintergrundjob',
    );
    assert.equal(
      appRow.sliding,
      true,
      'Ohne sliding rueckt das Datum bei Benutzung nicht nach — dann muesste man alle 90 Tage neu tippen',
    );
    // And it is valid considerably longer than the browser's: whoever opens the app
    // should not have to type in their password weekly.
    assert.ok(
      new Date(appRow.expires_at) > new Date((await ablauf(webToken)).expires_at),
      'Der App-Token muss laenger laufen als die sieben festen Tage',
    );
    // Precondition: these are two DIFFERENT tokens, otherwise the rest checks nothing.
    assert.notEqual(webToken, appToken);

    // ── 3. Who am I? ─────────────────────────────────────────────────────
    const withCookie = await ruf('/me', { headers: { cookie: webCookie } });
    assert.equal(withCookie.status, 200);
    assert.equal(withCookie.body.loggedIn, true, 'Die Sitzung des Browsers wird nicht erkannt');
    assert.equal(withCookie.body.user.id, uid);

    const withToken = await ruf('/me', { headers: { authorization: `Bearer ${appToken}` } });
    assert.equal(withToken.status, 200);
    assert.equal(withToken.body.loggedIn, true, 'Der Token der App wird nicht erkannt');
    assert.equal(withToken.body.user.is_admin, true);

    // Without anything: 200 and „no". The browser asks this BEFORE every login —
    // a 401 there would be the normal answer to a normal question.
    const ohne = await ruf('/me');
    assert.equal(ohne.status, 200, 'Ohne Ausweis ist „nicht angemeldet" keine Störung');
    assert.equal(ohne.body.loggedIn, false);

    // With a token that does not exist: 401. The interceptor of the app makes
    // „Sitzung abgelaufen" out of it and leads back to the login
    // (RepoBasis.kt). With 200 it would stay with a dead token.
    const falsch = await ruf('/me', { headers: { authorization: 'Bearer ' + 'f'.repeat(64) } });
    assert.equal(
      falsch.status,
      401,
      'Ein vorgelegter, ungültiger Token muss 401 ergeben — sonst merkt die App den Ablauf nicht',
    );

    // ── 3b. If the invalidation fails, the logout has not succeeded ───────
    const konto = require('./helpers/sources').testServices().account;
    const echt = konto.tokenLoeschen;
    konto.tokenLoeschen = async () => {
      throw new Error('Datenbank weg');
    };
    try {
      const halb = await ruf('/logout', { method: 'POST', headers: { authorization: `Bearer ${webToken}` } });
      assert.equal(halb.status, 500, 'Ein Token, der gültig bleibt, darf nicht als abgemeldet gelten');
      assert.ok(await ablauf(webToken), 'Der Token ist noch da');
    } finally {
      konto.tokenLoeschen = echt;
    }

    // ── 4. Logging out invalidates BOTH ────────────────────────────────────────
    const ab = await ruf('/logout', {
      method: 'POST',
      headers: { cookie: webCookie, authorization: `Bearer ${webToken}` },
    });
    assert.equal(ab.status, 200);
    assert.equal(await ablauf(webToken), undefined, 'Der Token muss beim Abmelden verschwinden');
    const danach = await ruf('/me', { headers: { cookie: webCookie } });
    assert.equal(danach.body.loggedIn, false, 'Die Sitzung muss beim Abmelden enden');
    // The token of the app is NOT affected by it — the browser logged out.
    const appStill = await ruf('/me', { headers: { authorization: `Bearer ${appToken}` } });
    assert.equal(appStill.body.loggedIn, true, 'Das Abmelden im Browser darf das Telefon nicht mit abmelden');

    // ── 5. A wrong password stays wrong ──────────────────────────────────
    const daneben = await ruf('/login', { method: 'POST', body: { username: NAME, password: 'falsch' } });
    assert.equal(daneben.status, 401);
    assert.equal(daneben.body.token, undefined, 'Ein fehlgeschlagener Login darf keinen Token ausgeben');
  } finally {
    await new Promise(r => srv.close(r));
    await db.run('DELETE FROM users WHERE username = $1', [NAME]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
