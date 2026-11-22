/**
 * Signed-in devices: list and lock out — both paths, real database.
 *
 * Counter-check (measured 09.11.2026): in DELETE /settings/tokens/:tokenId the
 * confirmation deleted → red: “without a password one device locks no other out”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire, einhaengung, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const AUTH = einhaengung('auth');
const SETTINGS = '/api/v1/settings';
const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAME = 'geraete_test',
  PASS = 'richtigesPasswort1';

test('list and lock out accesses — via session AND via token', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  await db.run(
    'INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,false,true,true)',
    [NAME, await bcrypt.hash(PASS, 4)],
  );

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
  app.use('/api/v1', require('./helpers/sources').routerFrom(_req, 'routes/api_v1/settings.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}`;

  const ruf = async (weg, opt = {}) => {
    const r = await fetch(basis + weg, {
      method: opt.method || 'GET',
      headers: { 'content-type': 'application/json', ...(opt.headers || {}) },
      ...(opt.body ? { body: JSON.stringify(opt.body) } : {}),
    });
    return { status: r.status, cookie: r.headers.get('set-cookie'), body: await r.json().catch(() => null) };
  };
  const anmelden = (extra = {}) =>
    ruf(AUTH + '/login', { method: 'POST', body: { username: NAME, password: PASS, ...extra } });

  try {
    // Three logins: a browser and two “phones" with their own labels.
    const browser = await anmelden();
    assert.equal(browser.status, 200, JSON.stringify(browser.body));
    const telefon = await anmelden({ label: 'Pixel 8', never_expires: true });
    const tablet = await anmelden({ label: 'Tablet', never_expires: true });
    // Session and token come from separate logins: a token login creates no session.
    const cookie = (await anmelden({ ohne_token: true })).cookie.split(';')[0];

    // ── 1. Via the SESSION (web app) ────────────────────────────────────────
    const perSession = await ruf(SETTINGS + '/tokens', { headers: { cookie } });
    assert.equal(perSession.status, 200, JSON.stringify(perSession.body));
    assert.equal(perSession.body.tokens.length, 3, 'Alle drei Anmeldungen müssen auftauchen');
    // The session ALONE says nothing about which row belongs to it —
    // the client must send its token along. Exactly that is checked by the next
    // block; so nothing may be marked here yet.
    assert.equal(
      perSession.body.tokens.filter(x => x.aktuell).length,
      0,
      'Ohne mitgeschickten Token ist keine Zeile als „dieses Gerät" erkennbar',
    );

    const withOwn = await ruf(SETTINGS + '/tokens', {
      headers: { cookie, authorization: `Bearer ${browser.body.token}` },
    });
    const markiert = withOwn.body.tokens.filter(x => x.aktuell);
    assert.equal(markiert.length, 1, 'Genau eine Zeile ist „dieses Gerät"');
    assert.equal(markiert[0].label, 'webapp-session');
    // The token itself must NOT come out — only a piece of its hash.
    assert.ok(
      !JSON.stringify(withOwn.body).includes(browser.body.token),
      'Der Klartext-Token darf in der Übersicht nicht auftauchen',
    );

    // ── 2. Via the TOKEN (app) ──────────────────────────────────────────────
    // Previously that was not possible at all: the route hung on the session, and the
    // app has none.
    const perToken = await ruf(SETTINGS + '/tokens', { headers: { authorization: `Bearer ${telefon.body.token}` } });
    assert.equal(perToken.status, 200, 'Die App muss ihre Zugänge sehen können');
    assert.equal(perToken.body.tokens.length, 3);
    assert.equal(perToken.body.tokens.find(x => x.aktuell)?.label, 'Pixel 8');
    // And the lifetimes are in there correctly — the display depends on that.
    for (const label of ['Pixel 8', 'webapp-session']) {
      const zeile = perToken.body.tokens.find(x => x.label === label);
      assert.equal(zeile.never_expires, false, `${label}: kein Token laeuft mehr „nie" ab`);
      assert.ok(zeile.expires_at, `${label}: ohne Datum hat die Anzeige nichts zu zeigen`);
    }
    // The phone's runs longer than the browser's — otherwise the
    // sliding period would be no relief but a tightening.
    assert.ok(
      new Date(perToken.body.tokens.find(x => x.label === 'Pixel 8').expires_at) >
        new Date(perToken.body.tokens.find(x => x.label === 'webapp-session').expires_at),
      'Der App-Token muss laenger laufen als die sieben Tage des Browsers',
    );

    // 3. Lock out a foreign device
    const warmUp = await ruf(AUTH + '/me', { headers: { authorization: `Bearer ${tablet.body.token}` } });
    assert.equal(
      warmUp.body.loggedIn,
      true,
      'Vorbedingung: Der Token des Tablets muss VOR dem Löschen gelten und damit im Cache liegen',
    );

    const deleteTo = perToken.body.tokens.find(x => x.label === 'Tablet');
    const ohne = await ruf(SETTINGS + '/tokens/' + deleteTo.token_id, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${telefon.body.token}` },
    });
    assert.equal(ohne.status, 400, 'ohne Passwort sperrt ein Gerät kein anderes aus');
    const weg = await ruf(SETTINGS + '/tokens/' + deleteTo.token_id, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${telefon.body.token}` },
      body: { password: PASS },
    });
    assert.equal(weg.status, 200);
    assert.equal(weg.body.deleted, 1);

    // And REALLY: the tablet's token no longer applies. That is the
    // point of the whole exercise — deleting the row is only half the job
    // if the cache in src/account/tokenCache.ts still serves it.
    const tabletTried = await ruf(AUTH + '/me', { headers: { authorization: `Bearer ${tablet.body.token}` } });
    assert.equal(
      tabletTried.status,
      401,
      'Der ausgesperrte Zugang gilt weiter — dann nützt die ganze Verwaltung nichts',
    );

    // The other two stay.
    const danach = await ruf(SETTINGS + '/tokens', { headers: { authorization: `Bearer ${telefon.body.token}` } });
    assert.deepEqual(danach.body.tokens.map(x => x.label).sort(), ['Pixel 8', 'webapp-session']);

    // ── 4. Foreign accesses are off limits ──────────────────────────────────
    // The filter goes via user_id. Without it every logged-in user could invalidate
    // any access if they guessed the start of the hash.
    await db.run('DELETE FROM users WHERE username = $1', [NAME + '_fremd']);
    await db.run(
      'INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,false,true,true)',
      [NAME + '_fremd', await bcrypt.hash(PASS, 4)],
    );
    const fremd = await ruf(AUTH + '/login', {
      method: 'POST',
      body: { username: NAME + '_fremd', password: PASS, label: 'Fremd', never_expires: true },
    });
    const fremdSicht = await ruf(SETTINGS + '/tokens', { headers: { authorization: `Bearer ${fremd.body.token}` } });
    assert.deepEqual(
      fremdSicht.body.tokens.map(x => x.label),
      ['Fremd'],
      'Ein fremdes Konto darf die eigenen Zugänge nicht sehen',
    );
    const foreignAttempt = await ruf(SETTINGS + '/tokens/' + danach.body.tokens[0].token_id, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${fremd.body.token}` },
      body: { password: PASS },
    });
    assert.equal(foreignAttempt.body.deleted, 0, 'Ein fremdes Konto darf keinen Zugang entwerten');

    // ── 5. The % case: only the full identifier (16 hex characters) applies ──
    const alles = await ruf(SETTINGS + '/tokens/' + encodeURIComponent('%'), {
      method: 'DELETE',
      headers: { authorization: `Bearer ${telefon.body.token}` },
    });
    // Since 05.11.2026 the contract (PATH) already rejects the identifier.
    assert.equal(alles.status, 400, 'Ein "%" als Token-Kennung darf nicht alle Zugänge auf einmal löschen');
  } finally {
    await new Promise(r => srv.close(r));
    await db.run('DELETE FROM users WHERE username IN ($1, $2)', [NAME, NAME + '_fremd']).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
