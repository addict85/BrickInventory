/**
 * The selectable lifetime of a QR access — and who may select it.
 *
 * Counter-check (measured on 28.10.): the check of session and
 * password removed in /qr-token → red in the step „0. Ein Code nur mit Sitzung UND
 * Passwort"
 * Counter-check (measured on 03.11.): in /qr-token `?? APP_MAX_DURATION_DAYS`
 * removed → red „Ohne Wahl gilt die Höchstdauer von 180 Tagen"
 * Counter-check (22.11.2026): tokenDays() without Math.min (a choice above TOKEN_MAX_DAYS
 * applies) → red in 3b („12m“ gives 365); the cleanup step `boundUnlimited` deleted → red in 3c
 * (both measured: red “QR access: the lifetime is chosen by the creator …”)"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';
// Since the QR code carries the address of the server (src/infra/baseUrl.ts),
// APP_BASE_URL is a PRECONDITION of the route: without it it refuses with 503,
// so that no code goes out with the browser address. This file checks something
// else — here the precondition is only fulfilled, not checked. That is done by
// test/qr-address.test.js.
process.env.APP_BASE_URL = 'https://lego.example.org';
// The bound of every access (src/infra/config.ts); 180 here, so the choices below it stay distinct.
process.env.TOKEN_MAX_DAYS = '180';

const { buildAndRequire, mounting, ohneKommentare, testData } = require('./helpers/sources');
const { pairQr } = require('./helpers/qr');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const AUTH = mounting('auth');
const db = testData();
const auth = _req('src/account/deviceToken.js');
const tokenCache = _req('src/account/tokenCache.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAME = `qr_laufzeit_${process.pid}`,
  PASS = 'richtigesPasswort1';

/** How many days in the future does this point in time lie? */
const daysAhead = wert => (new Date(wert).getTime() - Date.now()) / 86400_000;

test('QR access: the lifetime is chosen by the creator, not by the redeemer', { concurrency: 1 }, async t => {
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
  const basis = `http://localhost:${srv.address().port}${AUTH}`;

  const callFn = async (weg, opt = {}) => {
    const r = await fetch(basis + weg, {
      method: opt.method || 'GET',
      headers: { 'content-type': 'application/json', ...(opt.headers || {}) },
      ...(opt.body ? { body: JSON.stringify(opt.body) } : {}),
    });
    return { status: r.status, cookie: r.headers.get('set-cookie'), body: await r.json().catch(() => null) };
  };
  const link = (qr, keks) =>
    pairQr((p, body, kopf) => callFn(p, { method: 'POST', headers: kopf, body }), qr, { cookie: keks });
  /** The api_tokens row for an issued plaintext token. */
  const row = token =>
    db.get('SELECT expires_at, hard_expires_at, sliding, never_expires FROM api_tokens WHERE token = $1', [
      auth.tokenDigest(token),
    ]);

  try {
    const an = await callFn('/login', {
      method: 'POST',
      body: { username: NAME, password: PASS, without_token: true },
    });
    assert.equal(an.status, 200, `login failed: ${JSON.stringify(an.body)}`);
    const keks = an.cookie.split(';')[0];

    // ── 0. A code only with session AND password ──────────────────────────
    // Otherwise a captured token (or an open session) would create a new permanent access via the
    // QR path — without the password that /token-create
    // demands for exactly the same purpose.
    const withoutPw = await callFn('/qr-token', {
      method: 'POST',
      headers: { cookie: keks },
      body: { validity: '6m' },
    });
    assert.equal(withoutPw.status, 400, `without a password: ${withoutPw.status} ${JSON.stringify(withoutPw.body)}`);
    const falsch = await callFn('/qr-token', {
      method: 'POST',
      headers: { cookie: keks },
      body: { validity: '6m', password: 'falsch-falsch' },
    });
    assert.equal(falsch.status, 400);
    const device = await auth.createToken(uid, 'Probe', true);
    const perToken = await callFn('/qr-token', {
      method: 'POST',
      headers: { authorization: `Bearer ${device}` },
      body: { validity: 'unbegrenzt', password: PASS },
    });
    assert.equal(perToken.status, 403, 'A token alone must not create new access');

    // ── 1. The choice lands at the nonce ───────────────────────────────────
    const sechs = await callFn('/qr-token', {
      method: 'POST',
      headers: { cookie: keks },
      body: { validity: '6m', password: PASS },
    });
    assert.equal(sechs.status, 200, JSON.stringify(sechs.body));
    assert.equal(sechs.body.token_days, 180, 'Six months are 180 days');

    // ── 2. Redeeming creates BOTH periods ──────────────────────────
    const ein = await link(sechs.body, keks);
    assert.equal(ein.status, 200, JSON.stringify(ein.body));
    const z = await row(ein.body.token);
    assert.ok(z, 'A row must exist for the issued token');
    assert.equal(z.sliding, true, 'The sliding period stays — it is the backstop against forgotten devices');
    assert.ok(
      Math.abs(daysAhead(z.hard_expires_at) - 180) < 1,
      `The fixed period should be 180 days, measured: ${daysAhead(z.hard_expires_at)}`,
    );
    assert.ok(
      daysAhead(z.expires_at) < daysAhead(z.hard_expires_at),
      'The sliding period (90 days) is earlier — it applies first, just as promised',
    );

    // ── 3. The redeemer can choose NOTHING ────────────────────────
    //
    // The same request as above, only without a choice when creating and with a
    // wish in the body of the REDEMPTION. If this assertion falls, the
    // whole innovation is a vulnerability instead of a hardening.
    const ohne = await callFn('/qr-token', { method: 'POST', headers: { cookie: keks }, body: { password: PASS } });
    assert.equal(ohne.body.token_days, 180, 'Without a choice the maximum duration of 180 days applies');
    const versuch = await callFn('/qr-login', {
      method: 'POST',
      body: { token: ohne.body.token, validity: 'unbegrenzt', token_days: 3650 },
    });
    // The contract knows no wish when redeeming: 400, and the code stays unused.
    assert.deepEqual([versuch.status, versuch.body.code], [400, 'field_unknown'], JSON.stringify(versuch.body));
    const redeemed = await link(ohne.body, keks);
    assert.equal(redeemed.status, 200, JSON.stringify(redeemed.body));
    const zv = await row(redeemed.body.token);
    assert.ok(
      zv.hard_expires_at && Math.abs(daysAhead(zv.hard_expires_at) - 180) < 1,
      'The redeeming device must not grant itself a lifetime — otherwise a photographed code would suffice',
    );
    assert.ok(zv.expires_at, 'And certainly no unlimited one: the access must carry the ordinary sliding period');

    // 3b. There is no "unlimited" any more: the old choice and one above the bound give the bound.
    for (const [wahl, tage] of [
      ['unbegrenzt', 180],
      ['12m', 180],
    ]) {
      const r = await callFn('/qr-token', {
        method: 'POST',
        headers: { cookie: keks },
        body: { validity: wahl, password: PASS },
      });
      assert.equal(r.body.token_days, tage, `„${wahl}" yields the maximum duration from TOKEN_MAX_DAYS`);
      const ze = await row((await link(r.body, keks)).body.token);
      assert.ok(
        Math.abs(daysAhead(ze.hard_expires_at) - Number(tage)) < 1,
        `${wahl}: feste Frist ${ze.hard_expires_at}`,
      );
      assert.equal(ze.never_expires, false);
    }

    // 3c. A row from before (no end, as "unlimited" was): the cleanup run gives it one.
    const alt = await auth.createToken(uid, 'Altgerät', true);
    await db.run(
      'UPDATE api_tokens SET hard_expires_at = NULL, expires_at = NULL, sliding = FALSE, never_expires = TRUE WHERE token = $1',
      [auth.tokenDigest(alt)],
    );
    await auth.tokensCleanup();
    const limited = await row(alt);
    assert.ok(limited && Math.abs(daysAhead(limited.hard_expires_at) - 180) < 1, JSON.stringify(limited));
    assert.equal(limited.never_expires, false);

    // ── 4. A value outside the list does not reject, it chooses nothing ──
    //
    // Also `constructor`: a direct access to the table delivered for it
    // the inherited Object function — truthy, and thus it would have gone
    // to the database as a number of days (fromTable, src/infra/validate).
    for (const nonsense of ['99m', 'constructor', '__proto__', 999999]) {
      const r = await callFn('/qr-token', {
        method: 'POST',
        headers: { cookie: keks },
        body: { validity: nonsense, password: PASS },
      });
      assert.equal(r.status, 200, `„${nonsense}" should not fail but choose nothing`);
      assert.equal(r.body.token_days, 180, `„${nonsense}" may only yield the default of 180 days`);
    }

    // ── 5. The fixed period locks out even when the sliding one is open ──
    //
    // The actual purpose of the second column. Without the condition in
    // nutzerZumToken() it would only be decoration.
    const abgelaufen = await callFn('/qr-token', {
      method: 'POST',
      headers: { cookie: keks },
      body: { validity: '1m', password: PASS },
    });
    const zugang = await link(abgelaufen.body, keks);
    const roh = zugang.body.token;
    assert.ok(await auth.userForToken(roh), 'Freshly issued, the access must be valid');
    await db.run(`UPDATE api_tokens SET hard_expires_at = NOW() - INTERVAL '1 day' WHERE token = $1`, [
      auth.tokenDigest(roh),
    ]);
    tokenCache.tokenForgotten(roh); // otherwise the cache answers for up to a minute
    assert.equal(
      await auth.userForToken(roh),
      null,
      'Once the fixed date is reached the access is no longer valid — even if the sliding period is still running',
    );
  } finally {
    await new Promise(r => srv.close(r));
    await db.run('DELETE FROM users WHERE username = $1', [NAME]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});

test('QR access: the UI chooses when CREATING, not when redeeming', () => {
  const einst = ohneKommentare(require('./helpers/sources').ansichtQuelle('settings'));

  assert.ok(
    /api\('POST', '\/v2\/auth\/qr-token', \{ validity, password\b/.test(einst),
    'Die Webapp soll die gewaehlte Laufzeit beim Erzeugen des Codes mitschicken',
  );
  assert.ok(
    !/qr-login/.test(einst),
    'The web app does not redeem QR codes — if it did, this would be the second place ' +
      'where a lifetime could be chosen',
  );

  // And the selection must exist in the markup at all — a field that
  // einstellungen.js reads but nobody fills would be silently ineffective.
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(/id="qr-validity"/.test(html), 'The select field is missing in the interface');

  // And the selection matches the list of the server
  const serverList = [...auth.RUNTIME_CHOICES];
  for (const w of serverList) assert.notEqual(auth.runtimeDays(w), null, `the server does not know ${w}`);
  const markupList = [...html.matchAll(/<option value="(\w+)" data-i18n="qr\.validity_/g)].map(m => m[1]);
  assert.deepEqual(markupList, serverList, 'The choice in the markup and the list in TOKEN_RUNTIMES drift apart');
  assert.ok(serverList.length >= 2, "The server's list is too short");
  // No longer offered, but still accepted from older pages; it means the bound (3b above).
  assert.equal(auth.runtimeDays('unbegrenzt'), 0);
});
