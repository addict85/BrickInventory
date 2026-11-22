/**
 * The session cookie on the real server: with TLS `__Host-bim.sid` (Secure,
 * Path=/, without Domain), without TLS `bim.sid`. In both cases the
 * login works, the origin check recognizes the cookie, and logging out deletes
 * it under its name.
 *
 * Counter-checks (measured on 01.11.2026):
 *   A  `name: sessionCookieName()` removed in server.ts (connect.sid again)
 *      → red: “with TLS …” and “without TLS …”
 *   B  sessionCookieName() always returns `__Host-bim.sid` → red: “without TLS …”
 *   C  sessionCookieOptions() with `secure: false` → red: “with TLS …” (no
 *      Secure; leaving out `path` stays green, Path=/ is the default)
 *   D  clearCookie() removed in POST /logout → red: both („Abmelden: null")
 *   E  carriesSessionCookie() again on `connect.sid` → red: both („die
 *      Herkunftsprüfung erkennt das Cookie")
 *   F  (15.11.2026) signedInResponses() without keks_fehlt → red: both
 *      („über http: keks_fehlt" or „COOKIE_SECURE=0 …"); cookieStaysFrom()
 *      without `!req.secure` → red: “with TLS …” („über https kein Hinweis")
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATABASE_URL = URL_DB;
const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const { warte } = require('./helpers/time');
const { portOf } = require('./helpers/server');
const freePort = () =>
  new Promise(r => {
    const s = net.createServer().listen(0, () => {
      const p = portOf(s);
      s.close(() => r(p));
    });
  });

const NAME = `keks_${process.pid}`,
  PASS = 'Keks-Passwort-1';

/** The real server from dist/, in production; `env` decides on TLS. */
async function startServer(t, env) {
  const port = await freePort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DATABASE_URL: URL_DB,
      SESSION_SECRET: 'keks-test-geheimnis-lang-genug-1234',
      PORT: String(port),
      ROLE: 'web',
      NODE_ENV: 'production',
      DB_SUPERUSER_ALLOWED: '1',
      APP_BASE_URL_MISSING_OK: '1',
      ...env,
    },
  });
  let log = '';
  srv.stdout.on('data', d => {
    log += d;
  });
  srv.stderr.on('data', d => {
    log += d;
  });
  t.after(async () => {
    srv.kill('SIGTERM');
    for (let i = 0; i < 40 && srv.exitCode === null && srv.signalCode === null; i++) await warte(100);
    if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGKILL');
  });
  const basis = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 240 && (await fetch(`${basis}/api/v1/health/live`).catch(() => null)) === null; i++)
    await warte(250);
  return { basis, log: () => log };
}

/** Log in, ask with the cookie who one is, log out. */
async function pass(server, kopf) {
  const login = await fetch(`${server.basis}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...kopf },
    body: JSON.stringify({ username: NAME, password: PASS, ohne_token: true }),
  });
  const roh = await login.text();
  assert.equal(login.status, 200, `${roh}\n${server.log()}`);
  const setzen = login.headers.get('set-cookie');
  const cookie = setzen.split(';')[0];
  const ich = async () => (await fetch(`${server.basis}/api/v1/auth/me`, { headers: { cookie, ...kopf } })).json();
  const angemeldet = await ich();
  // A bearer header next to it must not switch off the origin check.
  const fremd = await fetch(`${server.basis}/api/v1/auth/logout`, {
    method: 'POST',
    headers: { cookie, ...kopf, authorization: 'Bearer x', 'sec-fetch-site': 'cross-site' },
  });
  await fremd.arrayBuffer();
  const ab = await fetch(`${server.basis}/api/v1/auth/logout`, {
    method: 'POST',
    headers: { cookie, ...kopf, 'sec-fetch-site': 'same-origin' },
  });
  await ab.arrayBuffer();
  return {
    antwort: JSON.parse(roh),
    setzen,
    cookie,
    angemeldet,
    fremd: fremd.status,
    loeschen: ab.headers.get('set-cookie'),
    danach: await ich(),
  };
}

test('session cookie with and without TLS', { concurrency: 1, timeout: 240_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  await db.run(`INSERT INTO users (username, password_hash, is_active, email_verified) VALUES ($1, $2, true, true)`, [
    NAME,
    bcrypt.hashSync(PASS, 4),
  ]);
  await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', [`%${NAME}%`]);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username = $1', [NAME]);
    await db.pool.end().catch(() => {});
  });

  // One server per case that ends with the case: only one web process runs on a database.
  await t.test('with TLS: __Host-bim.sid, Secure, Path=/, without Domain', async st => {
    const server = await startServer(st, {});
    const d = await pass(server, { 'x-forwarded-proto': 'https' });
    assert.match(d.setzen, /^__Host-bim\.sid=/, d.setzen);
    assert.match(d.setzen, /; Path=\/(;|$)/, d.setzen);
    assert.match(d.setzen, /; Secure(;|$)/, d.setzen);
    assert.doesNotMatch(d.setzen, /Domain=/i, d.setzen);
    assert.equal(d.angemeldet.loggedIn, true, 'die Anmeldung trägt');
    assert.equal(d.angemeldet.user.username, NAME);
    assert.equal(d.fremd, 403, 'die Herkunftsprüfung erkennt das Cookie');
    assert.match(d.loeschen ?? '', /^__Host-bim\.sid=;.*Path=\/.*Expires=Thu, 01 Jan 1970/, `Abmelden: ${d.loeschen}`);
    assert.match(d.loeschen, /; Secure(;|$)/, 'ohne Secure verwirft der Browser den Löschbefehl');
    assert.equal(d.danach.loggedIn, false);
    assert.equal(d.antwort.keks_fehlt, false, 'über https kein Hinweis');
    // The same login via http: express-session does not set the Secure cookie, the response says so.
    const ohne = await fetch(`${server.basis}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: NAME, password: PASS, ohne_token: true }),
    });
    const a = await ohne.json();
    assert.equal(ohne.status, 200, JSON.stringify(a));
    assert.equal(ohne.headers.get('set-cookie'), null, 'Cookie über http gesetzt');
    assert.equal(a.keks_fehlt, true, 'über http: keks_fehlt');
  });

  await t.test('without TLS: bim.sid without prefix and without Secure', async st => {
    const server = await startServer(st, { COOKIE_SECURE: '0' });
    const d = await pass(server, {});
    assert.match(d.setzen, /^bim\.sid=/, d.setzen);
    assert.doesNotMatch(d.setzen, /Secure/i, d.setzen);
    assert.equal(d.angemeldet.loggedIn, true, 'die Anmeldung trägt');
    assert.equal(d.fremd, 403, 'die Herkunftsprüfung erkennt das Cookie');
    assert.match(d.loeschen ?? '', /^bim\.sid=;/, `Abmelden: ${d.loeschen}`);
    assert.equal(d.danach.loggedIn, false);
    assert.equal(d.antwort.keks_fehlt, false, 'COOKIE_SECURE=0: das Cookie ging über http hinaus');
  });
});
