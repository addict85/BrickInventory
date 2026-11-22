/**
 * Cross-section of the usual classes on the running code: security headers
 * and cookie flags on the real server, no probing for taken email addresses
 * via the registration, no stack trace in an error response in
 * production.
 *
 * Counter-checks (measured 01.11.2026):
 *   A  Cross-Origin-Opener-Policy and -Resource-Policy in server.ts
 *      deleted → red: “every response carries the security headers”
 *   B  /register again answers 409 for a taken address → red: “a
 *      taken address responds like a new one”
 *   C  handleRouteError() also outputs e.message in production → red: “a
 *      server error in production names no internals”
 *   D  /register again answers 409 username_taken for a taken username
 *      → red: “a taken name responds like a
 *      new one” (measured 01.11.2026)
 *   E  in server.ts again `res.status(404).json({ success: false, error:
 *      'Endpoint nicht gefunden' })` instead of unknownApiPath → red: “an
 *      unknown API path responds in the form of every error response”
 *   F  handleRouteError() without `code` for 5xx → red: “a server error in
 *      production names no internals” (E and F measured 05.11.2026)
 *   G  in server.ts img-src again with `https:` → red: “every response carries
 *      the security headers”; likewise worker-src deleted and
 *      script-src with 'unsafe-inline' (each on its own, 08.11.2026)
 *   H  in index.html a `<script>var x=1;</script>` or a
 *      `<link rel="stylesheet" href="https://fonts.example/x.css">` → red:
 *      “the delivered page loads nothing from foreign hosts …” (08.11.2026)
 *   I  the normalization of double slashes removed in server.ts → red:
 *      “double slashes hit the same route …” (08.11.2026)
 *   J  (09.11.2026) in sessionCookieOptions() again `sameSite: 'lax'` → red:
 *      “the session cookie is httpOnly and SameSite=Strict”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATABASE_URL = URL_DB;
// Links in mails only exist with a fixed address (routes/auth.ts, getBaseUrl).
process.env.APP_BASE_URL = 'http://localhost';
const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer, portOf } = require('./helpers/server');
const { mailFake, enterMailServer } = require('./helpers/mail-fake');
const gesendet = mailFake();
const db = testData();
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const { warte } = require('./helpers/time');
const freePort = () =>
  new Promise(r => {
    const s = net.createServer().listen(0, () => {
      const p = portOf(s);
      s.close(() => r(p));
    });
  });

test('security across the board', { concurrency: 1, timeout: 180_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const NAME = `quer_${process.pid}`,
    PASS = 'Quer-Passwort-1',
    MAIL = `quer_${process.pid}@example.org`;
  const NEU = `quer_neu_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, NEU]]);
  await db.run(
    `INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, true, true)`,
    [NAME, MAIL, bcrypt.hashSync(PASS, 4)],
  );
  const regBefore = await db.get("SELECT value FROM global_settings WHERE key = 'registration_enabled'");
  await db.run(
    "INSERT INTO global_settings (key, value) VALUES ('registration_enabled', '1') ON CONFLICT (key) DO UPDATE SET value = '1'",
  );
  await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'register|%' OR key LIKE '%quer_%'");
  const mailBack = await enterMailServer(db);
  t.after(async () => {
    await mailBack();
    await db.run("DELETE FROM global_settings WHERE key = 'registration_enabled'");
    if (regBefore)
      await db.run("INSERT INTO global_settings (key, value) VALUES ('registration_enabled', $1)", [regBefore.value]);
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, NEU]]);
    await db.pool.end().catch(() => {});
  });

  const port = await freePort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DATABASE_URL: URL_DB,
      SESSION_SECRET: 'querschnitt-test-geheimnis-lang-genug-1234',
      PORT: String(port),
      TRUST_PROXY: 'false',
      ROLE: 'web',
    },
  });
  // Let it drain: a full buffer would stall the server.
  srv.stdout.resume();
  srv.stderr.resume();
  t.after(async () => {
    srv.kill('SIGTERM');
    for (let i = 0; i < 40 && srv.exitCode === null && srv.signalCode === null; i++) await warte(100);
    if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGKILL');
  });
  const basis = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 240 && (await fetch(`${basis}/api/v2/health/live`).catch(() => null)) === null; i++)
    await warte(250);

  await t.test('every response carries the security headers', async () => {
    for (const path of ['/', '/api/v2/health/live', '/api/v2/gibt-es-nicht']) {
      const r = await fetch(basis + path);
      await r.arrayBuffer();
      const k = n => r.headers.get(n);
      assert.equal(k('x-powered-by'), null, path);
      assert.match(k('content-security-policy'), /script-src 'self';/, path);
      assert.doesNotMatch(k('content-security-policy'), /unsafe-inline|unsafe-eval/, path);
      assert.deepEqual(
        [
          k('cross-origin-opener-policy'),
          k('cross-origin-resource-policy'),
          k('referrer-policy'),
          k('x-content-type-options'),
          k('x-frame-options'),
        ],
        ['same-origin', 'same-origin', 'same-origin', 'nosniff', 'SAMEORIGIN'],
        path,
      );
      assert.match(k('permissions-policy'), /camera=\(\).*geolocation=\(\)/, path);
      // Images only from the own server (image proxy), the PDF.js worker covered, no foreign host.
      const csp = Object.fromEntries(
        k('content-security-policy')
          .split(/;\s*/)
          .map(d => [d.split(' ')[0], d.split(' ').slice(1).join(' ')]),
      );
      assert.deepEqual(
        [csp['script-src'], csp['img-src'], csp['worker-src']],
        ["'self'", "'self' data: blob:", "'self' blob:"],
        path,
      );
      assert.doesNotMatch(k('content-security-policy'), /https?:/, path);
    }
  });

  await t.test('the delivered page loads nothing from foreign hosts and no inline script', async () => {
    const seite = await (await fetch(`${basis}/`)).text();
    assert.match(seite, /<script[^>]+src="[^"]*app\.bundle\.js/, 'nicht die App-Seite');
    const extern = [
      ...seite.matchAll(/<(?:link|script|img|iframe|source)\b[^>]*?\s(?:href|src)="((?:https?:)?\/\/[^"]+)"/g),
    ].map(m => m[1]);
    assert.deepEqual(extern, []);
    const inline = [...seite.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)]
      .map(m => m[1].trim())
      .filter(Boolean);
    assert.deepEqual(
      inline.map(b => b.slice(0, 60)),
      [],
      'script-src ohne unsafe-inline blockiert es',
    );
  });

  await t.test('double slashes hit the same route, not the page', async () => {
    for (const path of [
      '//api/v2/health/live',
      '/api//v1/health/live?x=1',
      '//api/v1/img-proxy?url=https%3A%2F%2Fcdn.rebrickable.com%2Fa.jpg',
    ]) {
      const r = await fetch(basis + path);
      await r.arrayBuffer();
      assert.match(r.headers.get('content-type') ?? '', /application\/json/, `${path}: ${r.status}`);
    }
  });

  await t.test('an unknown API path responds in the form of every error response', async () => {
    const r = await fetch(`${basis}/api/gibt-es-nicht`, { headers: { 'accept-language': 'en' } });
    const { request_id, ...rumpf } = await r.json();
    assert.deepEqual([r.status, rumpf], [404, { success: false, code: 'not_found', error: 'Not found' }]);
    assert.equal(request_id, r.headers.get('x-request-id'));
  });

  await t.test('the session cookie is httpOnly and SameSite=Strict', async () => {
    const r = await fetch(`${basis}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: NAME, password: PASS, without_token: true }),
    });
    assert.equal(r.status, 200, await r.text());
    const keks = r.headers.get('set-cookie');
    assert.match(keks, /HttpOnly/i);
    assert.match(keks, /SameSite=Strict/i);
  });

  await t.test('a taken address responds like a new one', async () => {
    const { base } = testServer(_req, { t });
    const register = (username, email) =>
      fetch(`${base}/api/v2/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, email, password: 'Neues-Passwort-1' }),
      }).then(async r => ({ status: r.status, body: await r.json() }));
    const vergeben = await register(NEU, MAIL.toUpperCase());
    assert.equal(vergeben.status, 200, JSON.stringify(vergeben.body));
    assert.equal(await db.get('SELECT id FROM users WHERE username = $1', [NEU]), undefined, 'Konto angelegt');
    assert.ok(
      gesendet.some(m => m.to === MAIL),
      'Der Inhaber bekommt keinen Hinweis',
    );
    const neu = await register(NEU, `anders_${MAIL}`);
    assert.deepEqual(vergeben.body, neu.body);
  });

  await t.test('a taken name responds like a new one, the address learns of it by mail', async () => {
    const { base } = testServer(_req, { t });
    await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'register|%'");
    const register = (username, email) =>
      fetch(`${base}/api/v2/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, email, password: 'Neues-Passwort-1' }),
      }).then(async r => ({ status: r.status, body: await r.json() }));
    const andere = `name_${MAIL}`;
    const vergeben = await register(NAME, andere);
    assert.equal(vergeben.status, 200, JSON.stringify(vergeben.body));
    assert.equal(await db.get('SELECT id FROM users WHERE email = $1', [andere]), undefined, 'Konto angelegt');
    assert.ok(
      gesendet.some(m => m.to === andere && /Benutzername schon vergeben/.test(m.subject)),
      gesendet.map(m => m.subject).join(' | '),
    );
    const NEU2 = `${NEU}_2`;
    const neu = await register(NEU2, `neu2_${MAIL}`);
    await db.run('DELETE FROM users WHERE username = $1', [NEU2]);
    assert.deepEqual(vergeben.body, neu.body);
  });
});

test('a server error in production names no internals', () => {
  const script = `const { handleRouteError } = require(${JSON.stringify(path.join(ROOT, 'dist/src/http/httpResponse.js'))});
    console.error = () => {};
    const res = { headersSent: false, status(s) { this.s = s; return this; }, json(b) { process.stdout.write(JSON.stringify([this.s, b])); } };
    handleRouteError(res, new Error('relation "geheim" at /app/dist/x.js:1'), undefined, { method: 'GET', originalUrl: '/x' });`;
  const aus = execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, NODE_ENV: 'production' },
  }).toString();
  assert.deepEqual(JSON.parse(aus), [
    500,
    { success: false, code: 'internal_error', error: 'Interner Fehler — Einzelheiten stehen im Protokoll.' },
  ]);
});
