/**
 * Querschnitt der üblichen Klassen am laufenden Code: Sicherheitskopfzeilen
 * und Cookie-Flags am echten Server, keine Abfrage vergebener E-Mail-Adressen
 * über die Registrierung, kein Stacktrace in einer Fehlerantwort der
 * Produktion.
 *
 * Gegenproben (01.11.2026 gemessen):
 *   A  Cross-Origin-Opener-Policy und -Resource-Policy in server.ts
 *      gestrichen → rot: „jede Antwort trägt die Sicherheitskopfzeilen"
 *   B  /register antwortet bei vergebener Adresse wieder 409 → rot: „eine
 *      vergebene Adresse antwortet wie eine neue"
 *   C  handleRouteError() gibt auch in Produktion e.message aus → rot: „ein
 *      Serverfehler in Produktion nennt keine Interna"
 *   D  /register antwortet bei vergebenem Benutzernamen wieder 409
 *      benutzername_vergeben → rot: „ein vergebener Name antwortet wie ein
 *      neuer" (gemessen 01.11.2026)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATABASE_URL = URL_DB;
// Links in Mails gibt es nur mit fester Adresse (routes/auth.ts, getBaseUrl).
process.env.APP_BASE_URL = 'http://localhost';
// Die Konsole zeigt die Empfängeradresse sonst nur maskiert (src/infra/mailer.ts).
process.env.MAIL_KONSOLE_MIT_TOKEN = '1';
const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const warte = (ms) => new Promise(r => setTimeout(r, ms));
const freierPort = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

test('Sicherheit im Querschnitt', { concurrency: 1, timeout: 180_000 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  const NAME = `quer_${process.pid}`, PASS = 'Quer-Passwort-1', MAIL = `quer_${process.pid}@example.org`;
  const NEU = `quer_neu_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, NEU]]);
  await db.run(`INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, true, true)`, [NAME, MAIL, bcrypt.hashSync(PASS, 4)]);
  const regVorher = await db.get("SELECT value FROM global_settings WHERE key = 'registration_enabled'");
  await db.run("INSERT INTO global_settings (key, value) VALUES ('registration_enabled', '1') ON CONFLICT (key) DO UPDATE SET value = '1'");
  await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'register|%' OR key LIKE '%quer_%'");
  t.after(async () => {
    await db.run("DELETE FROM global_settings WHERE key = 'registration_enabled'");
    if (regVorher) await db.run("INSERT INTO global_settings (key, value) VALUES ('registration_enabled', $1)", [regVorher.value]);
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, NEU]]);
    await db.pool.end().catch(() => {});
  });

  const port = await freierPort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: URL_DB, SESSION_SECRET: 'querschnitt-test-geheimnis-lang-genug-1234',
           PORT: String(port), TRUST_PROXY: 'false', ROLLE: 'web' },
  });
  let log = '';
  srv.stdout.on('data', d => { log += d; });
  srv.stderr.on('data', d => { log += d; });
  t.after(async () => {
    srv.kill('SIGTERM');
    for (let i = 0; i < 40 && srv.exitCode === null && srv.signalCode === null; i++) await warte(100);
    if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGKILL');
  });
  const basis = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 240 && (await fetch(`${basis}/api/v1/health/live`).catch(() => null)) === null; i++) await warte(250);

  await t.test('jede Antwort trägt die Sicherheitskopfzeilen', async () => {
    for (const pfad of ['/', '/api/v1/health/live', '/api/v1/gibt-es-nicht']) {
      const r = await fetch(basis + pfad);
      await r.arrayBuffer();
      const k = (n) => r.headers.get(n);
      assert.equal(k('x-powered-by'), null, pfad);
      assert.match(k('content-security-policy'), /script-src 'self';/, pfad);
      assert.doesNotMatch(k('content-security-policy'), /unsafe-inline|unsafe-eval/, pfad);
      assert.deepEqual([k('cross-origin-opener-policy'), k('cross-origin-resource-policy'), k('referrer-policy'),
        k('x-content-type-options'), k('x-frame-options')], ['same-origin', 'same-origin', 'same-origin', 'nosniff', 'SAMEORIGIN'], pfad);
      assert.match(k('permissions-policy'), /camera=\(\).*geolocation=\(\)/, pfad);
    }
  });

  await t.test('das Sitzungscookie ist httpOnly und SameSite=Lax', async () => {
    const r = await fetch(`${basis}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: NAME, password: PASS, ohne_token: true }) });
    assert.equal(r.status, 200, await r.text());
    const keks = r.headers.get('set-cookie');
    assert.match(keks, /HttpOnly/i);
    assert.match(keks, /SameSite=Lax/i);
  });

  await t.test('eine vergebene Adresse antwortet wie eine neue', async () => {
    const { base } = testServer(_req, { routen: { '/api/v1/auth': 'routes/auth.js' }, t });
    const meldungen = [], echt = console.log;
    console.log = (...a) => { meldungen.push(a.join(' ')); };
    const registriere = (username, email) => fetch(`${base}/api/v1/auth/register`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, email, password: 'Neues-Passwort-1' }) })
      .then(async r => ({ status: r.status, body: await r.json() }));
    try {
      const vergeben = await registriere(NEU, MAIL.toUpperCase());
      assert.equal(vergeben.status, 200, JSON.stringify(vergeben.body));
      assert.equal(await db.get('SELECT id FROM users WHERE username = $1', [NEU]), undefined, 'Konto angelegt');
      assert.ok(meldungen.some(m => m.includes(MAIL)), 'Der Inhaber bekommt keinen Hinweis');
      const neu = await registriere(NEU, `anders_${MAIL}`);
      assert.deepEqual(vergeben.body, neu.body);
    } finally { console.log = echt; }
  });

  await t.test('ein vergebener Name antwortet wie ein neuer, die Adresse erfährt es per Mail', async () => {
    const { base } = testServer(_req, { routen: { '/api/v1/auth': 'routes/auth.js' }, t });
    await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'register|%'");
    const meldungen = [], echt = console.log;
    console.log = (...a) => { meldungen.push(a.join(' ')); };
    const registriere = (username, email) => fetch(`${base}/api/v1/auth/register`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, email, password: 'Neues-Passwort-1' }) })
      .then(async r => ({ status: r.status, body: await r.json() }));
    try {
      const andere = `name_${MAIL}`;
      const vergeben = await registriere(NAME, andere);
      assert.equal(vergeben.status, 200, JSON.stringify(vergeben.body));
      assert.equal(await db.get('SELECT id FROM users WHERE email = $1', [andere]), undefined, 'Konto angelegt');
      assert.ok(meldungen.some(m => m.includes(andere)) && meldungen.some(m => /Benutzername schon vergeben/.test(m)), meldungen.join(' | '));
      const NEU2 = `${NEU}_2`;
      const neu = await registriere(NEU2, `neu2_${MAIL}`);
      await db.run('DELETE FROM users WHERE username = $1', [NEU2]);
      assert.deepEqual(vergeben.body, neu.body);
    } finally { console.log = echt; }
  });
});

test('ein Serverfehler in Produktion nennt keine Interna', () => {
  const skript = `const { handleRouteError } = require(${JSON.stringify(path.join(ROOT, 'dist/src/infra/httpError.js'))});
    console.error = () => {};
    const res = { headersSent: false, status(s) { this.s = s; return this; }, json(b) { process.stdout.write(JSON.stringify([this.s, b])); } };
    handleRouteError(res, new Error('relation "geheim" at /app/dist/x.js:1'), undefined, { method: 'GET', originalUrl: '/x' });`;
  const aus = execFileSync(process.execPath, ['-e', skript], { env: { ...process.env, NODE_ENV: 'production' } }).toString();
  assert.deepEqual(JSON.parse(aus), [500, { success: false, error: 'Interner Serverfehler' }]);
});
