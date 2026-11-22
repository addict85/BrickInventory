/**
 * The sliding expiry of the app token — real database.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';
// Not the default 90: this way the test shows that the period comes from the configuration.
process.env.TOKEN_IDLE_DAYS = '23';

const { buildAndRequire, mounting, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { bis } = require('./helpers/time');
const AUTH = mounting('auth');
const db = testData();
const auth = _req('src/account/deviceToken.js');
const tokenCache = _req('src/account/tokenCache.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAME = 'gleitfrist_test',
  PASS = 'richtigesPasswort1';
const TAG = 86400_000;

test('the expiry date of the app token slides with use', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  await db.run(
    'INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,false,true,true)',
    [NAME, await bcrypt.hash(PASS, 4)],
  );
  const uid = (await db.get('SELECT id FROM users WHERE username=$1', [NAME])).id;

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
  app.use(AUTH, require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}`;

  const callFn = async (weg, opt = {}) => {
    const r = await fetch(basis + weg, {
      method: opt.method || 'GET',
      headers: { 'content-type': 'application/json', ...(opt.headers || {}) },
      ...(opt.body ? { body: JSON.stringify(opt.body) } : {}),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const row = klartext =>
    db.get('SELECT expires_at, sliding FROM api_tokens WHERE token = $1', [auth.tokenDigest(klartext)]);

  try {
    const frist = _req('src/infra/config.js').config().tokenIdleDays;
    assert.equal(frist, 23, 'die Frist kommt aus TOKEN_IDLE_DAYS');

    // ── 1. The app token ────────────────────────────────────────────────────
    const appA = await callFn(AUTH + '/login', {
      method: 'POST',
      body: { username: NAME, password: PASS, label: 'Android App', never_expires: true },
    });
    assert.equal(appA.status, 200, `Anmeldung scheiterte: ${JSON.stringify(appA.body)}`);
    const appToken = appA.body.token;
    const appRow = await row(appToken);
    assert.equal(appRow.sliding, true, 'Der App-Token muss als gleitend markiert sein');
    // Exact to the day instead of to the millisecond: between the INSERT and
    // this line real time passes, and NOW() is that of the database.
    const daysUntil = d => Math.round((new Date(d).getTime() - Date.now()) / TAG);
    assert.equal(
      daysUntil(appRow.expires_at),
      frist,
      `Der App-Token muss ${frist} Tage laufen — die Frist steht in TOKEN_IDLE_DAYS`,
    );

    // ── 2. The browser token does not slide ──────────────────────────────────
    const webA = await callFn(AUTH + '/login', { method: 'POST', body: { username: NAME, password: PASS } });
    const webRow = await row(webA.body.token);
    assert.equal(
      webRow.sliding,
      false,
      'Der Token im sessionStorage darf NICHT gleiten — sonst haelt ihn ein Angreifer durch Benutzung am Leben',
    );
    assert.equal(daysUntil(webRow.expires_at), 7, 'Die sieben festen Tage des Browsers bleiben');

    // 3. The silent renewal
    await db.run("UPDATE api_tokens SET expires_at = NOW() + INTERVAL '3 days' WHERE token = $1", [
      auth.tokenDigest(appToken),
    ]);
    tokenCache.emptyTokenCache();
    const wer = await callFn(AUTH + '/me', { headers: { authorization: `Bearer ${appToken}` } });
    assert.equal(wer.body?.user?.id, uid, 'Vorbedingung: Die Anfrage muss ueberhaupt durchgehen');

    // The UPDATE runs without await in the request path (fire-and-forget, so that
    // auth does not cost two DB rounds). Hence we wait instead of guess —
    // a fixed sleep would be either too short or a waste of time.
    await bis(async () => daysUntil((await row(appToken)).expires_at) > 3, 2000);
    assert.equal(
      daysUntil((await row(appToken)).expires_at),
      frist,
      'Die Benutzung muss das Ablaufdatum wieder auf die volle Frist schieben — sonst ' +
        'sperrt sich ein taeglich benutztes Telefon nach 90 Tagen selbst aus',
    );

    // Counter-check in the same situation: the browser token is used just the same and
    // must NOT extend itself.
    await db.run("UPDATE api_tokens SET expires_at = NOW() + INTERVAL '3 days' WHERE token = $1", [
      auth.tokenDigest(webA.body.token),
    ]);
    tokenCache.emptyTokenCache();
    await callFn(AUTH + '/me', { headers: { authorization: `Bearer ${webA.body.token}` } });
    // The touch writes last_used; only afterwards is it certain that it did not push the period.
    assert.ok(
      await bis(
        async () =>
          (await db.get('SELECT last_used FROM api_tokens WHERE token = $1', [auth.tokenDigest(webA.body.token)]))
            ?.last_used,
      ),
      'die Benutzung wurde nicht vermerkt',
    );
    assert.equal(
      daysUntil((await row(webA.body.token)).expires_at),
      3,
      'Der Browser-Token darf durch Benutzung nicht laenger werden',
    );

    // 4. Update legacy rows
    const alt = 'a'.repeat(64);
    await db.run('DELETE FROM api_tokens WHERE token = $1', [alt]);
    await db.run(
      `INSERT INTO api_tokens (token, user_id, label, expires_at, created_at, last_used)
       VALUES ($1,$2,'Altzeile',NULL, NOW() - INTERVAL '40 days', NOW() - INTERVAL '10 days')`,
      [alt, uid],
    );
    await auth.tokensCleanup();
    const followedUp = await db.get('SELECT expires_at, sliding FROM api_tokens WHERE token = $1', [alt]);
    assert.ok(followedUp, 'Die Altzeile darf nicht geloescht werden — sie ist noch gueltig');
    assert.equal(followedUp.sliding, true, 'Eine Altzeile ohne Datum war ein App-/QR-Token und gleitet');
    assert.equal(
      Math.round((new Date(followedUp.expires_at).getTime() - Date.now()) / TAG),
      frist - 10,
      'Nachgezogen wird ab der letzten Nutzung, nicht ab jetzt — sonst verlaengert die Umstellung jede Altzeile',
    );

    // 5. A legacy row that was never used counts from its creation and falls.
    // Counter-check (measured 11.11.2026): in tokensCleanup() the sum replaced by 0
    // → red „das Aufräumen zählt …“.
    const nie = 'b'.repeat(64);
    await db.run('DELETE FROM api_tokens WHERE token = $1', [nie]);
    await db.run(
      `INSERT INTO api_tokens (token, user_id, label, expires_at, created_at, last_used)
       VALUES ($1,$2,'Nie benutzt',NULL, NOW() - INTERVAL '40 days', NULL)`,
      [nie, uid],
    );
    assert.ok((await auth.tokensCleanup()) >= 1, 'das Aufräumen zählt, was es entfernt');
    assert.equal(
      await db.get('SELECT 1 FROM api_tokens WHERE token = $1', [nie]),
      undefined,
      'eine nie benutzte Altzeile ist nach 40 Tagen über der Frist von 23',
    );
  } finally {
    // Both AWAITED, and the pool is closed: without that the
    // file does not run to the end but into the 60-second time limit of
    // `npm test` — the checks in it have long been green, the file counts
    // as failed nevertheless. Exactly that happened when writing this test …
    await new Promise(r => srv.close(r));
    await db.run('DELETE FROM users WHERE username = $1', [NAME]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
