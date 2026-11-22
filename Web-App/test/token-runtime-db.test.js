/**
 * The selectable lifetime of a QR access — and who may select it.
 *
 * Counter-check (measured on 28.10.): the check of session and
 * password removed in /qr-token → red in the step „0. Ein Code nur mit Sitzung UND
 * Passwort"
 * Counter-check (measured on 03.11.): in /qr-token `?? APP_MAX_DURATION_DAYS`
 * removed → red „Ohne Wahl gilt die Höchstdauer von 180 Tagen"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';
// Since the QR code carries the address of the server (src/infra/basisUrl.ts),
// APP_BASE_URL is a PRECONDITION of the route: without it it refuses with 503,
// so that no code goes out with the browser address. This file checks something
// else — here the precondition is only fulfilled, not checked. That is done by
// test/qr-address.test.js.
process.env.APP_BASE_URL = 'https://lego.example.org';

const { buildAndRequire, einhaengung, ohneKommentare, testData } = require('./helpers/sources');
const { pairQr } = require('./helpers/qr');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const AUTH = einhaengung('auth');
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

  const ruf = async (weg, opt = {}) => {
    const r = await fetch(basis + weg, {
      method: opt.method || 'GET',
      headers: { 'content-type': 'application/json', ...(opt.headers || {}) },
      ...(opt.body ? { body: JSON.stringify(opt.body) } : {}),
    });
    return { status: r.status, cookie: r.headers.get('set-cookie'), body: await r.json().catch(() => null) };
  };
  const koppeln = (qr, keks) =>
    pairQr((p, body, kopf) => ruf(p, { method: 'POST', headers: kopf, body }), qr, { cookie: keks });
  /** The api_tokens row for an issued plaintext token. */
  const zeile = token =>
    db.get('SELECT expires_at, hard_expires_at, sliding FROM api_tokens WHERE token = $1', [auth.tokenDigest(token)]);

  try {
    const an = await ruf('/login', { method: 'POST', body: { username: NAME, password: PASS, ohne_token: true } });
    assert.equal(an.status, 200, `Anmeldung scheiterte: ${JSON.stringify(an.body)}`);
    const keks = an.cookie.split(';')[0];

    // ── 0. A code only with session AND password ──────────────────────────
    // Otherwise a captured token (or an open session) would create a new permanent access via the
    // QR path — without the password that /token-create
    // demands for exactly the same purpose.
    const withoutPw = await ruf('/qr-token', {
      method: 'POST',
      headers: { cookie: keks },
      body: { gueltigkeit: '6m' },
    });
    assert.equal(withoutPw.status, 400, `ohne Passwort: ${withoutPw.status} ${JSON.stringify(withoutPw.body)}`);
    const falsch = await ruf('/qr-token', {
      method: 'POST',
      headers: { cookie: keks },
      body: { gueltigkeit: '6m', password: 'falsch-falsch' },
    });
    assert.equal(falsch.status, 400);
    const geraet = await auth.createToken(uid, 'Probe', true);
    const perToken = await ruf('/qr-token', {
      method: 'POST',
      headers: { authorization: `Bearer ${geraet}` },
      body: { gueltigkeit: 'unbegrenzt', password: PASS },
    });
    assert.equal(perToken.status, 403, 'Mit einem Token allein darf kein neuer Zugang entstehen');

    // ── 1. The choice lands at the nonce ───────────────────────────────────
    const sechs = await ruf('/qr-token', {
      method: 'POST',
      headers: { cookie: keks },
      body: { gueltigkeit: '6m', password: PASS },
    });
    assert.equal(sechs.status, 200, JSON.stringify(sechs.body));
    assert.equal(sechs.body.token_days, 180, 'Sechs Monate sind 180 Tage');

    // ── 2. Redeeming creates BOTH periods ──────────────────────────
    const ein = await koppeln(sechs.body, keks);
    assert.equal(ein.status, 200, JSON.stringify(ein.body));
    const z = await zeile(ein.body.token);
    assert.ok(z, 'Zum ausgegebenen Token muss eine Zeile existieren');
    assert.equal(z.sliding, true, 'Die Gleitfrist bleibt — sie ist der Rueckhalt gegen vergessene Geraete');
    assert.ok(
      Math.abs(daysAhead(z.hard_expires_at) - 180) < 1,
      `Die feste Frist soll 180 Tage betragen, gemessen: ${daysAhead(z.hard_expires_at)}`,
    );
    assert.ok(
      daysAhead(z.expires_at) < daysAhead(z.hard_expires_at),
      'Die gleitende Frist (90 Tage) liegt frueher — sie greift zuerst, genau wie zugesagt',
    );

    // ── 3. The redeemer can choose NOTHING ────────────────────────
    //
    // The same request as above, only without a choice when creating and with a
    // wish in the body of the REDEMPTION. If this assertion falls, the
    // whole innovation is a vulnerability instead of a hardening.
    const ohne = await ruf('/qr-token', { method: 'POST', headers: { cookie: keks }, body: { password: PASS } });
    assert.equal(ohne.body.token_days, 180, 'Ohne Wahl gilt die Höchstdauer von 180 Tagen');
    const versuch = await ruf('/qr-login', {
      method: 'POST',
      body: { token: ohne.body.token, gueltigkeit: 'unbegrenzt', token_days: 3650 },
    });
    // The contract knows no wish when redeeming: 400, and the code stays unused.
    assert.deepEqual([versuch.status, versuch.body.code], [400, 'feld_unbekannt'], JSON.stringify(versuch.body));
    const eingeloest = await koppeln(ohne.body, keks);
    assert.equal(eingeloest.status, 200, JSON.stringify(eingeloest.body));
    const zv = await zeile(eingeloest.body.token);
    assert.ok(
      zv.hard_expires_at && Math.abs(daysAhead(zv.hard_expires_at) - 180) < 1,
      'Das einloesende Geraet darf sich keine Laufzeit erteilen — sonst reicht ein abfotografierter Code',
    );
    assert.ok(zv.expires_at, 'Und erst recht keine unbegrenzte: Der Zugang muss die gewoehnliche Gleitfrist tragen');

    // 3b. „Unlimited" really means unlimited
    const ewig = await ruf('/qr-token', {
      method: 'POST',
      headers: { cookie: keks },
      body: { gueltigkeit: 'unbegrenzt', password: PASS },
    });
    assert.equal(ewig.body.token_days, 0, '„unbegrenzt" reist als 0 mit — null hiesse „nichts gewaehlt"');
    const accessForever = await koppeln(ewig.body, keks);
    const rawForever = accessForever.body.token;
    const ze = await zeile(rawForever);
    assert.equal(ze.expires_at, null, 'Unbegrenzt heisst: keine gleitende Frist');
    assert.equal(ze.hard_expires_at, null, 'Unbegrenzt heisst: auch keine feste Frist');
    assert.equal(ze.sliding, false, 'Ohne Datum darf die Zeile auch nicht gleiten');

    await db.run(
      `UPDATE api_tokens SET last_used = NOW() - INTERVAL '400 days',
                             created_at = NOW() - INTERVAL '400 days'
        WHERE token = $1`,
      [auth.tokenDigest(rawForever)],
    );
    await auth.tokensCleanup();
    const nachher = await zeile(rawForever);
    assert.ok(nachher, 'Der unbegrenzte Zugang darf vom Aufraeumjob nicht geloescht werden');
    assert.equal(
      nachher.expires_at,
      null,
      'Der Aufraeumjob darf ihm auch kein Ablaufdatum verpassen — sonst waere die Wahl still weg',
    );
    tokenCache.tokenForgotten(rawForever);
    assert.ok(await auth.nutzerZumToken(rawForever), 'Und er muss nach dem Aufraeumen noch gelten');

    // ── 4. A value outside the list does not reject, it chooses nothing ──
    //
    // Also `constructor`: a direct access to the table delivered for it
    // the inherited Object function — truthy, and thus it would have gone
    // to the database as a number of days (fromTable, src/infra/validate).
    for (const nonsense of ['99m', 'constructor', '__proto__', 999999]) {
      const r = await ruf('/qr-token', {
        method: 'POST',
        headers: { cookie: keks },
        body: { gueltigkeit: nonsense, password: PASS },
      });
      assert.equal(r.status, 200, `„${nonsense}" soll nicht scheitern, sondern nichts waehlen`);
      assert.equal(r.body.token_days, 180, `„${nonsense}" darf nur die Vorgabe von 180 Tagen ergeben`);
    }

    // ── 5. The fixed period locks out even when the sliding one is open ──
    //
    // The actual purpose of the second column. Without the condition in
    // nutzerZumToken() it would only be decoration.
    const abgelaufen = await ruf('/qr-token', {
      method: 'POST',
      headers: { cookie: keks },
      body: { gueltigkeit: '1m', password: PASS },
    });
    const zugang = await koppeln(abgelaufen.body, keks);
    const roh = zugang.body.token;
    assert.ok(await auth.nutzerZumToken(roh), 'Frisch ausgestellt muss der Zugang gelten');
    await db.run(`UPDATE api_tokens SET hard_expires_at = NOW() - INTERVAL '1 day' WHERE token = $1`, [
      auth.tokenDigest(roh),
    ]);
    tokenCache.tokenForgotten(roh); // otherwise the cache answers for up to a minute
    assert.equal(
      await auth.nutzerZumToken(roh),
      null,
      'Ist der feste Termin erreicht, gilt der Zugang nicht mehr — auch wenn die Gleitfrist noch laeuft',
    );
  } finally {
    await new Promise(r => srv.close(r));
    await db.run('DELETE FROM users WHERE username = $1', [NAME]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});

test('QR access: the UI chooses when CREATING, not when redeeming', () => {
  const einst = ohneKommentare(require('./helpers/sources').ansichtQuelle('einstellungen'));

  assert.ok(
    /api\('POST', '\/v1\/auth\/qr-token', \{ gueltigkeit: validity, password\b/.test(einst),
    'Die Webapp soll die gewaehlte Laufzeit beim Erzeugen des Codes mitschicken',
  );
  assert.ok(
    !/qr-login/.test(einst),
    'Die Webapp loest keine QR-Codes ein — taete sie es, waere hier die zweite Stelle, ' +
      'an der eine Laufzeit gewaehlt werden koennte',
  );

  // And the selection must exist in the markup at all — a field that
  // einstellungen.js reads but nobody fills would be silently ineffective.
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(/id="qr-validity"/.test(html), 'Das Auswahlfeld fehlt in der Oberflaeche');

  // And the selection matches the list of the server
  const serverList = [...auth.RUNTIME_CHOICES];
  for (const w of serverList) assert.notEqual(auth.runtimeDays(w), null, `${w} kennt der Server nicht`);
  const markupList = [...html.matchAll(/<option value="(\w+)" data-i18n="qr\.validity_/g)].map(m => m[1]);
  assert.deepEqual(markupList, serverList, 'Die Auswahl im Markup und die Liste in TOKEN_RUNTIMES laufen auseinander');
  assert.ok(serverList.length >= 5, 'Die Liste des Servers ist zu kurz');
  assert.ok(serverList.includes('unbegrenzt'), 'Die Wahl „unbegrenzt" fehlt auf der Serverseite');
});
