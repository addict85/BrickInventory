/**
 * Tokens: scope, sliding expiry, rotation, a fixed end for every token,
 * device list and the migration of existing tokens — against a real
 * database and the login path as in the server (entrance, api_v1, settings, auth).
 *
 * Counter-checks (measured on 30.10.2026):
 *   A  the scope not respected in checkToken() (is_admin = konto_is_admin) →
 *      red: “scope app: even an administrator account gets no administrator rights”
 *   B  in /qr-login again establishSession() with isAdmin → red: the same
 *      check (the response sets a session cookie)
 *   C  the daily rule removed in _touchLastUsed() (always write) → red:
 *      “expiry slides, written at most once per day”
 *   D  in rotateToken() the unused successor not replaced → red:
 *      “rotation: …” (B still applies after the second exchange)
 *   E  in checkToken() the predecessor not deleted on the first use →
 *      red: “rotation: …” (the old one still applies after use of the new one)
 *   F  (22.11.2026) in createToken() no fixed end at the bound (hard_expires_at NULL for
 *      TOKEN_MAX_DAYS, as „unbegrenzt“ was) → red: “app login: fixed maximum duration …” and
 *      “no access without an end, …”
 *   G  rotationRequired() always false → red: the same check (status 200 instead of 401)
 *   H  never_expires not reset in migration 0080 → red:
 *      “migration 0080: …”
 *   I  `replaced_by IS NULL` removed in accessesOfAccount() → red:
 *      “device list: …” (the exchanged device stood there twice)
 *   J  (22.11.2026) the cleanup step `boundUnlimited` deleted → red: “no access without an
 *      end, …” (the legacy row keeps never_expires)
 *   K  (02.11.2026) in createSuccessor() hard_expires_at set to NOW() + 180
 *      days → red: the same check („der Tausch verlängert …“)
 *   L  (09.11.2026) in deleteAccess() the predecessor (`left(replaced_by, 16)`)
 *      not deleted along → red: “device list: …” (the predecessor lives on)
 *
 * Prerequisite: test DB (contents are touched!) via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const { environment, testData } = require('./helpers/sources');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
environment({ SESSION_SECRET: 'test-secret-lang-genug-fuer-die-pruefung' });
environment({ APP_BASE_URL: 'http://lego.test:3000' });
// The device key comes with a test chain (helpers/attestation.js).
environment(require('./helpers/attestation').UMGEBUNG);

const { buildAndRequire } = require('./helpers/sources');
const { pairQr } = require('./helpers/qr');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const auth = _req('src/account/deviceToken.js');
const tokenCache = _req('src/account/tokenCache.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAME = 'scope_chef',
  PASS = 'richtigesPasswort1';
const TAG = 86400_000;
const daysUntil = d => (new Date(d).getTime() - Date.now()) / TAG;

test('tokens with scope, expiry and rotation', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  await require('./helpers/attestation').storeRevocationList(db);

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  await db.run(
    'INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,true,true,true)',
    [NAME, await bcrypt.hash(PASS, 4)],
  );
  const uid = (await db.get('SELECT id FROM users WHERE username=$1', [NAME])).id;
  // Admins need a code generator: login and confirmation each take a
  // recovery code; if the ten do not suffice, new ones come.
  const vorrat = await require('./helpers/admin').adminWithFactor(_req, uid);
  const code = async () => {
    if (!vorrat.length) vorrat.push(...(await _req('src/factors/secondFactor.js').renewCodes(uid)));
    return vorrat.shift();
  };

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
  app.use(
    '/api/v1',
    _req('routes/api_v1/middleware.js').guardFor(require('./helpers/sources').testServices().account).loginAtInbox,
  );
  app.use('/api/v1', require('./helpers/sources').routerFrom(_req, 'routes/api_v1/index.js'));
  app.use('/api/v1', require('./helpers/sources').routerFrom(_req, 'routes/api_v1/settings.js'));
  app.use('/api/v1/auth', require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}`;
  t.after(async () => {
    await new Promise(r => srv.close(r));
    await db.run('DELETE FROM users WHERE username = $1', [NAME]);
    await db.pool.end();
  });

  const ruf = async (weg, opt = {}) => {
    const r = await fetch(basis + '/api/v1' + weg, {
      method: opt.method || 'GET',
      headers: {
        'content-type': 'application/json',
        ...(opt.token ? { authorization: `Bearer ${opt.token}` } : {}),
        ...(opt.cookie ? { cookie: opt.cookie } : {}),
      },
      ...(opt.body ? { body: JSON.stringify(opt.body) } : {}),
    });
    return { status: r.status, kopf: r.headers, body: await r.json().catch(() => null) };
  };
  const zeile = klartext => db.get('SELECT * FROM api_tokens WHERE token = $1', [auth.tokenDigest(klartext)]);
  const anmelden = async (body = {}) => {
    const a = await ruf('/auth/login', {
      method: 'POST',
      body: { username: NAME, password: PASS, code: await code(), ...body },
    });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    return a;
  };
  const sitzung = (await anmelden({ ohne_token: true })).kopf.get('set-cookie').split(';')[0];
  const qrToken = async gueltigkeit => {
    const q = await ruf('/auth/qr-token', {
      method: 'POST',
      cookie: sitzung,
      body: { password: PASS, gueltigkeit, code: await code() },
    });
    return q;
  };
  const qrLogin = async gueltigkeit => {
    const q = await qrToken(gueltigkeit);
    assert.equal(q.status, 200, JSON.stringify(q.body));
    const l = await pairQr((p, body, kopf) => ruf('/auth' + p, { method: 'POST', body, cookie: kopf.cookie }), q.body, {
      cookie: sitzung,
    });
    assert.equal(l.status, 200, JSON.stringify(l.body));
    return l;
  };

  await t.test('scope app: even an administrator account gets no administrator rights', async () => {
    const qr = await qrLogin();
    assert.equal(qr.body.token_info.scope, 'app');
    assert.equal(qr.kopf.get('set-cookie'), null, 'Der QR-Login darf keine Sitzung anlegen');
    assert.equal((await ruf('/admin/cache-ttl', { token: qr.body.token })).status, 403);
    const ich = await ruf('/auth/me', { token: qr.body.token });
    assert.equal(ich.body.user.is_admin, false);
    assert.equal(ich.body.token_info.scope, 'app');

    const withoutWish = (await anmelden({ never_expires: true })).body.token;
    assert.equal((await zeile(withoutWish)).scope, 'app', 'Ohne Wunsch bekommt die Anmeldung Scope app');
    assert.equal((await ruf('/admin/cache-ttl', { token: withoutWish })).status, 403);

    const voll = await anmelden({ never_expires: true, scope: 'voll' });
    assert.equal(voll.body.token_info.scope, 'voll');
    // Admin rights of an app token only after the device lock (step-protection-db.test.js).
    await require('./helpers/device').releaseDevice(ruf, voll.body.token, 'verwaltung');
    assert.equal((await ruf('/admin/cache-ttl', { token: voll.body.token })).status, 200);
    assert.equal((await ruf('/admin/cache-ttl', { cookie: sitzung })).status, 200, 'Die Sitzung behält die Rechte');
  });

  await t.test('expiry slides, written at most once per day', async () => {
    const tok = (await anmelden({ never_expires: true })).body.token;
    assert.ok(Math.abs(daysUntil((await zeile(tok)).expires_at) - 90) < 0.01, 'Vorgabe 90 Tage');

    // Unused for two days: the next request pushes the period and the last use.
    await db.run(
      `UPDATE api_tokens SET last_used = NOW() - INTERVAL '2 days', expires_at = NOW() + INTERVAL '88 days',
                  ip_range = NULL WHERE token = $1`,
      [auth.tokenDigest(tok)],
    );
    tokenCache.emptyTokenCache();
    assert.equal((await ruf('/auth/me', { token: tok })).status, 200);
    let z;
    for (let i = 0; i < 100; i++) {
      z = await zeile(tok);
      if (daysUntil(z.expires_at) > 89) break;
      await new Promise(r => setTimeout(r, 20));
    }
    assert.ok(Math.abs(daysUntil(z.expires_at) - 90) < 0.01, 'Die Nutzung verlängert auf 90 Tage');
    assert.match(String(z.ip_range), /\/(24|48)$/, 'Der Adressbereich wird mitgeschrieben');

    // Written 23 hours ago: further requests write nothing.
    await db.run(
      `UPDATE api_tokens SET last_used = NOW() - INTERVAL '23 hours',
                  expires_at = NOW() + INTERVAL '89 days 1 hour' WHERE token = $1`,
      [auth.tokenDigest(tok)],
    );
    const vorher = await zeile(tok);
    tokenCache.emptyTokenCache();
    for (let i = 0; i < 3; i++) assert.equal((await ruf('/auth/me', { token: tok })).status, 200);
    await new Promise(r => setTimeout(r, 300));
    const nachher = await zeile(tok);
    assert.equal(
      nachher.last_used.getTime(),
      vorher.last_used.getTime(),
      'Innerhalb eines Tages wird nicht geschrieben',
    );
    assert.equal(nachher.expires_at.getTime(), vorher.expires_at.getTime());
  });

  await t.test('rotation: new for old, short overlap, repeated exchange replaces the unused one', async () => {
    const a = (await anmelden({ never_expires: true, scope: 'voll', label: 'Telefon' })).body.token;
    const r1 = await ruf('/auth/token-rotieren', { method: 'POST', token: a });
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    const b = r1.body.token;
    assert.notEqual(b, a);
    assert.equal(r1.body.token_info.scope, 'voll', 'Der Scope reist mit');
    assert.equal(r1.body.ueberlappung_sek, 300);
    const rest = (new Date(r1.body.alt_gueltig_bis).getTime() - Date.now()) / 1000;
    assert.ok(rest > 250 && rest <= 300, `alter Token gilt noch ${rest} s`);
    assert.equal((await zeile(b)).label, 'Telefon');

    // Response lost: the old one exchanges once more, the unused B drops away —
    // after the lock window against concurrent exchanges (token-swap-parallel-db).
    assert.equal((await ruf('/auth/me', { token: a })).status, 200, 'Der alte gilt in der Überlappung');
    await db.run(`UPDATE api_tokens SET rotated_at = NOW() - INTERVAL '1 minute' WHERE token = $1`, [
      auth.tokenDigest(b),
    ]);
    const r2 = await ruf('/auth/token-rotieren', { method: 'POST', token: a });
    assert.equal(r2.status, 200);
    const c = r2.body.token;
    tokenCache.emptyTokenCache();
    assert.equal((await ruf('/auth/me', { token: b })).status, 401, 'Der ersetzte Nachfolger gilt nicht mehr');

    // The first use of C ends the overlap.
    assert.equal((await ruf('/auth/me', { token: c })).status, 200);
    tokenCache.emptyTokenCache();
    assert.equal((await ruf('/auth/me', { token: a })).status, 401, 'Nach Nutzung des neuen ist der alte weg');
    assert.equal((await ruf('/auth/token-rotieren', { method: 'POST', token: a })).status, 401);
    assert.equal((await ruf('/auth/token-rotieren', { method: 'POST', token: 'f'.repeat(64) })).status, 401);
  });

  await t.test('app login: fixed maximum duration (TOKEN_MAX_DAYS, 90) that the exchange does not extend', async () => {
    const a = (await anmelden({ never_expires: true, label: 'Höchstdauer' })).body.token;
    const z = await zeile(a);
    assert.ok(
      z.hard_expires_at && Math.abs(daysUntil(z.hard_expires_at) - 90) < 0.01,
      `feste Frist 90 Tage, gemessen: ${z.hard_expires_at}`,
    );
    assert.ok(Math.abs(daysUntil(z.expires_at) - 90) < 0.01, 'die Gleitfrist bleibt daneben');
    // 80 days after the login: an exchange inherits the remaining ten days.
    await db.run(`UPDATE api_tokens SET hard_expires_at = NOW() + INTERVAL '10 days' WHERE token = $1`, [
      auth.tokenDigest(a),
    ]);
    tokenCache.emptyTokenCache();
    const r = await ruf('/auth/token-rotieren', { method: 'POST', token: a });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const n = await zeile(r.body.token);
    assert.ok(
      Math.abs(daysUntil(n.hard_expires_at) - 10) < 0.01,
      `der Tausch verlängert die Höchstdauer: ${n.hard_expires_at}`,
    );
    assert.ok(daysUntil(r.body.token_info.expires_at) <= 10.01, 'die Antwort nennt das frühere Ende');
  });

  await t.test('no access without an end, not even over HTTPS; old rows still must rotate', async () => {
    environment({ APP_BASE_URL: 'https://lego.test' });
    try {
      const qr = await qrLogin('unbegrenzt');
      const u = qr.body.token;
      assert.equal(qr.body.token_info.never_expires, false);
      assert.ok(
        Math.abs(daysUntil(qr.body.token_info.hard_expires_at) - 90) < 0.01,
        JSON.stringify(qr.body.token_info),
      );
      const t2 = (
        await ruf('/auth/token-create', {
          method: 'POST',
          cookie: sitzung,
          body: { password: PASS, code: await code() },
        })
      ).body;
      assert.ok(Math.abs(daysUntil(t2.token_info.hard_expires_at) - 90) < 0.01, 'token-create endet auch');

      // A row from before migration 0126 (never_expires, no date) until the cleanup run bounds it.
      await db.run(
        `UPDATE api_tokens SET never_expires = TRUE, expires_at = NULL, hard_expires_at = NULL, sliding = FALSE,
                rotated_at = NOW() - INTERVAL '31 days' WHERE token = $1`,
        [auth.tokenDigest(u)],
      );
      tokenCache.emptyTokenCache();
      const faellig = await ruf('/auth/me', { token: u });
      assert.equal(faellig.status, 200);
      assert.equal(faellig.kopf.get('x-token-rotation'), 'faellig');
      assert.equal(faellig.body.token_info.rotation_faellig, true);
      assert.equal((await ruf('/settings/tokens', { token: u })).kopf.get('x-token-rotation'), 'faellig');

      await db.run(`UPDATE api_tokens SET rotated_at = NOW() - INTERVAL '61 days' WHERE token = $1`, [
        auth.tokenDigest(u),
      ]);
      tokenCache.emptyTokenCache();
      const gesperrt = await ruf('/settings/tokens', { token: u });
      assert.equal(gesperrt.status, 401);
      assert.equal(gesperrt.body.code, 'token_rotation_noetig');

      const neu = await ruf('/auth/token-rotieren', { method: 'POST', token: u });
      assert.equal(neu.status, 200, JSON.stringify(neu.body));
      assert.equal((await ruf('/settings/tokens', { token: neu.body.token })).status, 200);
      await auth.tokensCleanup();
      const begrenzt = await zeile(neu.body.token);
      assert.equal(begrenzt.never_expires, false, 'der Aufräumlauf nimmt dem Nachfolger das „unbegrenzt“');
      assert.ok(Math.abs(daysUntil(begrenzt.hard_expires_at) - 90) < 0.01, `${begrenzt.hard_expires_at}`);
    } finally {
      environment({ APP_BASE_URL: 'http://lego.test:3000' });
    }
  });

  await t.test('device list: name, scope, usage, range, expiry; individually revocable', async () => {
    const g = (await anmelden({ never_expires: true, label: 'Tablet' })).body.token;
    await ruf('/auth/me', { token: g });
    const r = await ruf('/auth/token-rotieren', { method: 'POST', token: g });
    const neu = r.body.token;
    // Still in the overlap: the old token lives but does not count as a device.
    const liste = (await ruf('/settings/tokens', { cookie: sitzung })).body.tokens;
    const tablets = liste.filter(x => x.label === 'Tablet');
    assert.equal(tablets.length, 1, 'Ein getauschtes Gerät steht einmal da');
    const e = tablets[0];
    assert.equal(e.scope, 'app');
    assert.ok(e.last_used && e.expires_at && e.created_at && e.rotated_at);
    assert.match(String(e.ip_range), /\/(24|48)$/);
    assert.equal(e.never_expires, false);

    assert.equal(e.token_id, auth.tokenDigest(neu).slice(0, 16), 'Es steht der neue Token da');
    const weg = await ruf('/settings/tokens/' + e.token_id, {
      method: 'DELETE',
      cookie: sitzung,
      body: { password: PASS, code: await code() },
    });
    assert.equal(weg.body.deleted, 1, 'der Vorgänger in der Überlappung zählt nicht als eigenes Gerät');
    assert.equal((await ruf('/auth/me', { token: neu })).status, 401);
    assert.equal((await ruf('/auth/me', { token: g })).status, 401, 'der Vorgänger in der Überlappung lebt weiter');
  });

  await t.test('migration 0080: existing tokens get scope full and at most 90 days', async () => {
    const sql = fs.readFileSync(path.join(ROOT, 'db/migrations/0080-token-scope-rotation.sql'), 'utf8');
    const c = await db.pool.connect();
    try {
      await c.query('BEGIN');
      // A temporary table in the old form covers the real one (pg_temp first).
      await c.query(`CREATE TEMP TABLE api_tokens (token text PRIMARY KEY, user_id int, created_at timestamptz DEFAULT now(),
        last_used timestamptz DEFAULT now(), expires_at timestamptz, sliding boolean NOT NULL DEFAULT false,
        hard_expires_at timestamptz, never_expires boolean NOT NULL DEFAULT false, label text)`);
      await c.query(`INSERT INTO api_tokens (token, user_id, expires_at, sliding, never_expires) VALUES
        ('ewig', 1, NULL, false, true), ('lang', 1, NOW() + INTERVAL '200 days', true, false),
        ('kurz', 1, NOW() + INTERVAL '3 days', false, false), ('alt', 1, NULL, false, false)`);
      await c.query(sql);
      const z = Object.fromEntries((await c.query('SELECT * FROM api_tokens')).rows.map(r => [r.token, r]));
      for (const k of ['ewig', 'lang', 'kurz', 'alt']) assert.equal(z[k].scope, 'voll', `${k}: Scope voll`);
      for (const k of ['ewig', 'lang', 'alt']) {
        assert.ok(Math.abs(daysUntil(z[k].expires_at) - 90) < 0.01, `${k}: jetzt + 90 Tage`);
        assert.equal(z[k].never_expires, false);
        assert.equal(z[k].sliding, true);
      }
      assert.ok(Math.abs(daysUntil(z.kurz.expires_at) - 3) < 0.01, 'Eine kürzere Frist bleibt');
      assert.equal(z.kurz.sliding, false);
      await c.query(`INSERT INTO api_tokens (token, user_id) VALUES ('neu', 1)`);
      assert.equal(
        (await c.query(`SELECT scope FROM api_tokens WHERE token = 'neu'`)).rows[0].scope,
        'app',
        'Neue Zeilen bekommen ohne Angabe Scope app',
      );
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});
