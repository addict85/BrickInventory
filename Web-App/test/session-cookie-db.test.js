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
const { sleep } = require('./helpers/time');
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
    for (let i = 0; i < 40 && srv.exitCode === null && srv.signalCode === null; i++) await sleep(100);
    if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGKILL');
  });
  const basis = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 240 && (await fetch(`${basis}/api/v2/health/live`).catch(() => null)) === null; i++)
    await sleep(250);
  return { basis, log: () => log };
}

/** Log in, ask with the cookie who one is, log out. */
async function pass(server, head) {
  const login = await fetch(`${server.basis}/api/v2/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...head },
    body: JSON.stringify({ username: NAME, password: PASS, without_token: true }),
  });
  const raw = await login.text();
  assert.equal(login.status, 200, `${raw}\n${server.log()}`);
  const put = login.headers.get('set-cookie');
  const cookie = put.split(';')[0];
  const ich = async () => (await fetch(`${server.basis}/api/v2/auth/me`, { headers: { cookie, ...head } })).json();
  const signedIn = await ich();
  // A bearer header next to it must not switch off the origin check.
  const fremd = await fetch(`${server.basis}/api/v2/auth/logout`, {
    method: 'POST',
    headers: { cookie, ...head, authorization: 'Bearer x', 'sec-fetch-site': 'cross-site' },
  });
  await fremd.arrayBuffer();
  const ab = await fetch(`${server.basis}/api/v2/auth/logout`, {
    method: 'POST',
    headers: { cookie, ...head, 'sec-fetch-site': 'same-origin' },
  });
  await ab.arrayBuffer();
  return {
    response: JSON.parse(raw),
    put,
    cookie,
    signedIn,
    fremd: fremd.status,
    remove: ab.headers.get('set-cookie'),
    afterwards: await ich(),
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

  // One server per case that ends with the case, each with its own environment.
  await t.test('with TLS: __Host-bim.sid, Secure, Path=/, without Domain', async st => {
    const server = await startServer(st, {});
    const d = await pass(server, { 'x-forwarded-proto': 'https' });
    assert.match(d.put, /^__Host-bim\.sid=/, d.put);
    assert.match(d.put, /; Path=\/(;|$)/, d.put);
    assert.match(d.put, /; Secure(;|$)/, d.put);
    assert.doesNotMatch(d.put, /Domain=/i, d.put);
    assert.equal(d.signedIn.loggedIn, true, 'the login carries');
    assert.equal(d.signedIn.user.username, NAME);
    assert.equal(d.fremd, 403, 'the origin check recognises the cookie');
    assert.match(d.remove ?? '', /^__Host-bim\.sid=;.*Path=\/.*Expires=Thu, 01 Jan 1970/, `sign-out: ${d.remove}`);
    assert.match(d.remove, /; Secure(;|$)/, 'without Secure the browser discards the delete command');
    assert.equal(d.afterwards.loggedIn, false);
    assert.equal(d.response.cookie_missing, false, 'no hint over https');
    // The same login via http: express-session does not set the Secure cookie, the response says so.
    const without = await fetch(`${server.basis}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: NAME, password: PASS, without_token: true }),
    });
    const a = await without.json();
    assert.equal(without.status, 200, JSON.stringify(a));
    assert.equal(without.headers.get('set-cookie'), null, 'cookie set over http');
    assert.equal(a.cookie_missing, true, 'over http: keks_fehlt');
  });

  await t.test('without TLS: bim.sid without prefix and without Secure', async st => {
    const server = await startServer(st, { COOKIE_SECURE: '0' });
    const d = await pass(server, {});
    assert.match(d.put, /^bim\.sid=/, d.put);
    assert.doesNotMatch(d.put, /Secure/i, d.put);
    assert.equal(d.signedIn.loggedIn, true, 'the login carries');
    assert.equal(d.fremd, 403, 'the origin check recognises the cookie');
    assert.match(d.remove ?? '', /^bim\.sid=;/, `logout: ${d.remove}`);
    assert.equal(d.afterwards.loggedIn, false);
    assert.equal(d.response.cookie_missing, false, 'COOKIE_SECURE=0: the cookie went out over http');
  });
});
