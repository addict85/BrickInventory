/**
 * Tokens: Scope, gleitender Ablauf, Rotation, „unbegrenzt“ nur über HTTPS,
 * Geräteliste und die Migration der Bestandstokens — gegen eine echte
 * Datenbank und den Anmeldeweg wie im Server (Eingang, api_v1, settings, auth).
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  in pruefeToken() den Scope nicht beachtet (is_admin = konto_is_admin) →
 *      rot: „Scope app: auch ein Verwalterkonto bekommt keine Verwalterrechte“
 *   B  in /qr-login wieder establishSession() mit isAdmin → rot: dieselbe
 *      Prüfung (die Antwort setzt ein Sitzungscookie)
 *   C  in _touchLastUsed() die Tagesregel entfernt (immer schreiben) → rot:
 *      „Ablauf gleitet, geschrieben wird höchstens einmal je Tag“
 *   D  in rotiereToken() den unbenutzten Nachfolger nicht ersetzt → rot:
 *      „Rotation: …“ (B gilt nach dem zweiten Tausch weiter)
 *   E  in pruefeToken() den Vorgänger bei der ersten Nutzung nicht gelöscht →
 *      rot: „Rotation: …“ (der alte gilt nach Nutzung des neuen weiter)
 *   F  in /qr-token die https-Prüfung für „unbegrenzt“ entfernt → rot:
 *      „unbegrenzt nur über HTTPS, und dann mit Rotationspflicht“
 *   G  rotationPflicht() immer false → rot: dieselbe Prüfung (Status 200 statt 401)
 *   H  in der Migration 0080 never_expires nicht zurückgesetzt → rot:
 *      „Migration 0080: …“
 *   I  in zugaengeDesKontos() `ersetzt_durch IS NULL` entfernt → rot:
 *      „Geräteliste: …“ (das getauschte Gerät stand doppelt da)
 *
 * Voraussetzung: Test-DB (Inhalt wird angefasst!) via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';
process.env.APP_BASE_URL = 'http://lego.test:3000';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const db   = _req('db/database.js');
const auth = _req('utils/auth.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt  = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAME = 'scope_chef', PASS = 'richtigesPasswort1';
const TAG = 86400_000;
const tageBis = (d) => (new Date(d).getTime() - Date.now()) / TAG;

test('Tokens mit Scope, Ablauf und Rotation', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  await db.run('INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,1,1,1)',
    [NAME, await bcrypt.hash(PASS, 4)]);
  const uid = (await db.get('SELECT id FROM users WHERE username=$1', [NAME])).id;

  const app = express();
  app.use(express.json());
  app.use(session({
    store: new pgSession({ pool: db.pool, tableName: 'user_sessions' }),
    secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false,
  }));
  app.use('/api/v1', _req('routes/api_v1/middleware.js').anmeldungAmEingang);
  app.use('/api/v1', _req('routes/api_v1/index.js'));
  app.use('/api/v1/settings', _req('routes/settings.js'));
  app.use('/api/v1/auth', _req('routes/auth.js'));
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
      headers: { 'content-type': 'application/json',
        ...(opt.token ? { authorization: `Bearer ${opt.token}` } : {}),
        ...(opt.cookie ? { cookie: opt.cookie } : {}) },
      ...(opt.body ? { body: JSON.stringify(opt.body) } : {}),
    });
    return { status: r.status, kopf: r.headers, body: await r.json().catch(() => null) };
  };
  const zeile = (klartext) => db.get(
    'SELECT * FROM api_tokens WHERE token = $1', [auth.hashToken(klartext)]);
  const anmelden = async (body = {}) => {
    const a = await ruf('/auth/login', { method: 'POST', body: { username: NAME, password: PASS, ...body } });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    return a;
  };
  const sitzung = (await anmelden({ ohne_token: true })).kopf.get('set-cookie').split(';')[0];
  const qrToken = async (gueltigkeit) => {
    const q = await ruf('/auth/qr-token', { method: 'POST', cookie: sitzung, body: { password: PASS, gueltigkeit } });
    return q;
  };
  const qrLogin = async (gueltigkeit) => {
    const q = await qrToken(gueltigkeit);
    assert.equal(q.status, 200, JSON.stringify(q.body));
    const l = await ruf('/auth/qr-login', { method: 'POST', body: { token: q.body.token } });
    assert.equal(l.status, 200, JSON.stringify(l.body));
    return l;
  };

  await t.test('Scope app: auch ein Verwalterkonto bekommt keine Verwalterrechte', async () => {
    const qr = await qrLogin();
    assert.equal(qr.body.token_info.scope, 'app');
    assert.equal(qr.kopf.get('set-cookie'), null, 'Der QR-Login darf keine Sitzung anlegen');
    assert.equal((await ruf('/admin/cache-ttl', { token: qr.body.token })).status, 403);
    const ich = await ruf('/auth/me', { token: qr.body.token });
    assert.equal(ich.body.user.is_admin, false);
    assert.equal(ich.body.token_info.scope, 'app');

    const ohneWunsch = (await anmelden({ never_expires: true })).body.token;
    assert.equal((await zeile(ohneWunsch)).scope, 'app', 'Ohne Wunsch bekommt die Anmeldung Scope app');
    assert.equal((await ruf('/admin/cache-ttl', { token: ohneWunsch })).status, 403);

    const voll = await anmelden({ never_expires: true, scope: 'voll' });
    assert.equal(voll.body.token_info.scope, 'voll');
    assert.equal((await ruf('/admin/cache-ttl', { token: voll.body.token })).status, 200);
    assert.equal((await ruf('/admin/cache-ttl', { cookie: sitzung })).status, 200, 'Die Sitzung behält die Rechte');
  });

  await t.test('Ablauf gleitet, geschrieben wird höchstens einmal je Tag', async () => {
    const tok = (await anmelden({ never_expires: true })).body.token;
    assert.ok(Math.abs(tageBis((await zeile(tok)).expires_at) - 90) < 0.01, 'Vorgabe 90 Tage');

    // Zwei Tage nicht benutzt: Die nächste Anfrage schiebt Frist und letzte Nutzung.
    await db.run(`UPDATE api_tokens SET last_used = NOW() - INTERVAL '2 days', expires_at = NOW() + INTERVAL '88 days',
                  ip_bereich = NULL WHERE token = $1`, [auth.hashToken(tok)]);
    auth.leereTokenCache();
    assert.equal((await ruf('/auth/me', { token: tok })).status, 200);
    let z;
    for (let i = 0; i < 100; i++) {
      z = await zeile(tok);
      if (tageBis(z.expires_at) > 89) break;
      await new Promise(r => setTimeout(r, 20));
    }
    assert.ok(Math.abs(tageBis(z.expires_at) - 90) < 0.01, 'Die Nutzung verlängert auf 90 Tage');
    assert.match(String(z.ip_bereich), /\/(24|48)$/, 'Der Adressbereich wird mitgeschrieben');

    // Vor 23 Stunden geschrieben: Weitere Anfragen schreiben nichts.
    await db.run(`UPDATE api_tokens SET last_used = NOW() - INTERVAL '23 hours',
                  expires_at = NOW() + INTERVAL '89 days 1 hour' WHERE token = $1`, [auth.hashToken(tok)]);
    const vorher = await zeile(tok);
    auth.leereTokenCache();
    for (let i = 0; i < 3; i++) assert.equal((await ruf('/auth/me', { token: tok })).status, 200);
    await new Promise(r => setTimeout(r, 300));
    const nachher = await zeile(tok);
    assert.equal(nachher.last_used.getTime(), vorher.last_used.getTime(), 'Innerhalb eines Tages wird nicht geschrieben');
    assert.equal(nachher.expires_at.getTime(), vorher.expires_at.getTime());
  });

  await t.test('Rotation: neu gegen alt, kurze Überlappung, wiederholter Tausch ersetzt den unbenutzten', async () => {
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

    // Antwort verloren: Der alte tauscht noch einmal, der unbenutzte B fällt weg.
    assert.equal((await ruf('/auth/me', { token: a })).status, 200, 'Der alte gilt in der Überlappung');
    const r2 = await ruf('/auth/token-rotieren', { method: 'POST', token: a });
    assert.equal(r2.status, 200);
    const c = r2.body.token;
    auth.leereTokenCache();
    assert.equal((await ruf('/auth/me', { token: b })).status, 401, 'Der ersetzte Nachfolger gilt nicht mehr');

    // Die erste Nutzung von C beendet die Überlappung.
    assert.equal((await ruf('/auth/me', { token: c })).status, 200);
    auth.leereTokenCache();
    assert.equal((await ruf('/auth/me', { token: a })).status, 401, 'Nach Nutzung des neuen ist der alte weg');
    assert.equal((await ruf('/auth/token-rotieren', { method: 'POST', token: a })).status, 401);
    assert.equal((await ruf('/auth/token-rotieren', { method: 'POST', token: 'f'.repeat(64) })).status, 401);
  });

  await t.test('unbegrenzt nur über HTTPS, und dann mit Rotationspflicht', async () => {
    const http = await qrToken('unbegrenzt');
    assert.equal(http.status, 400);
    assert.equal(http.body.code, 'unbegrenzt_nur_https');

    process.env.APP_BASE_URL = 'https://lego.test';
    try {
      const qr = await qrLogin('unbegrenzt');
      const u = qr.body.token;
      assert.equal(qr.body.token_info.never_expires, true);
      assert.equal(qr.body.token_info.expires_at, null);

      await db.run(`UPDATE api_tokens SET rotiert_am = NOW() - INTERVAL '31 days' WHERE token = $1`, [auth.hashToken(u)]);
      auth.leereTokenCache();
      const faellig = await ruf('/auth/me', { token: u });
      assert.equal(faellig.status, 200);
      assert.equal(faellig.kopf.get('x-token-rotation'), 'faellig');
      assert.equal(faellig.body.token_info.rotation_faellig, true);
      assert.equal((await ruf('/settings/tokens', { token: u })).kopf.get('x-token-rotation'), 'faellig');

      await db.run(`UPDATE api_tokens SET rotiert_am = NOW() - INTERVAL '61 days' WHERE token = $1`, [auth.hashToken(u)]);
      auth.leereTokenCache();
      const gesperrt = await ruf('/settings/tokens', { token: u });
      assert.equal(gesperrt.status, 401);
      assert.equal(gesperrt.body.code, 'token_rotation_noetig');
      assert.equal((await ruf('/auth/me', { token: u })).body.code, 'token_rotation_noetig');

      const neu = await ruf('/auth/token-rotieren', { method: 'POST', token: u });
      assert.equal(neu.status, 200, JSON.stringify(neu.body));
      assert.equal(neu.body.token_info.never_expires, true, 'Unbegrenzt bleibt unbegrenzt');
      const ok = await ruf('/settings/tokens', { token: neu.body.token });
      assert.equal(ok.status, 200);
      assert.equal(ok.kopf.get('x-token-rotation'), null);
    } finally { process.env.APP_BASE_URL = 'http://lego.test:3000'; }
  });

  await t.test('Geräteliste: Name, Scope, Nutzung, Bereich, Ablauf; einzeln widerrufbar', async () => {
    const g = (await anmelden({ never_expires: true, label: 'Tablet' })).body.token;
    await ruf('/auth/me', { token: g });
    const r = await ruf('/auth/token-rotieren', { method: 'POST', token: g });
    const neu = r.body.token;
    // Noch in der Überlappung: Der alte Token lebt, zählt aber nicht als Gerät.
    const liste = (await ruf('/settings/tokens', { cookie: sitzung })).body.tokens;
    const tablets = liste.filter(x => x.label === 'Tablet');
    assert.equal(tablets.length, 1, 'Ein getauschtes Gerät steht einmal da');
    const e = tablets[0];
    assert.equal(e.scope, 'app');
    assert.ok(e.last_used && e.expires_at && e.created_at && e.rotiert_am);
    assert.match(String(e.ip_bereich), /\/(24|48)$/);
    assert.equal(e.never_expires, false);

    assert.equal(e.token_id, auth.hashToken(neu).slice(0, 16), 'Es steht der neue Token da');
    const weg = await ruf('/settings/tokens/' + e.token_id, { method: 'DELETE', cookie: sitzung });
    assert.equal(weg.body.deleted, 1);
    assert.equal((await ruf('/auth/me', { token: neu })).status, 401);
  });

  await t.test('Migration 0080: Bestand bekommt Scope voll und höchstens 90 Tage', async () => {
    const sql = fs.readFileSync(path.join(ROOT, 'db', 'migrations', '0080-token-scope-rotation.sql'), 'utf8');
    const c = await db.pool.connect();
    try {
      await c.query('BEGIN');
      // Eine temporäre Tabelle in der alten Form verdeckt die echte (pg_temp zuerst).
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
        assert.ok(Math.abs(tageBis(z[k].expires_at) - 90) < 0.01, `${k}: jetzt + 90 Tage`);
        assert.equal(z[k].never_expires, false);
        assert.equal(z[k].sliding, true);
      }
      assert.ok(Math.abs(tageBis(z.kurz.expires_at) - 3) < 0.01, 'Eine kürzere Frist bleibt');
      assert.equal(z.kurz.sliding, false);
      await c.query(`INSERT INTO api_tokens (token, user_id) VALUES ('neu', 1)`);
      assert.equal((await c.query(`SELECT scope FROM api_tokens WHERE token = 'neu'`)).rows[0].scope, 'app',
        'Neue Zeilen bekommen ohne Angabe Scope app');
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});
