/**
 * Das Sitzungscookie am echten Server: mit TLS `__Host-bim.sid` (Secure,
 * Path=/, ohne Domain), ohne TLS `bim.sid`. In beiden Fällen trägt die
 * Anmeldung, die Herkunftsprüfung erkennt das Cookie, und die Abmeldung löscht
 * es unter seinem Namen.
 *
 * Gegenproben (am 01.11.2026 gemessen):
 *   A  in server.ts `name: sitzungsKeksName()` entfernt (wieder connect.sid)
 *      → rot: „mit TLS …" und „ohne TLS …"
 *   B  sitzungsKeksName() gibt immer `__Host-bim.sid` → rot: „ohne TLS …"
 *   C  sitzungsKeksOptionen() mit `secure: false` → rot: „mit TLS …" (kein
 *      Secure; `path` wegzulassen bleibt grün, Path=/ ist die Vorgabe)
 *   D  in POST /logout clearCookie() entfernt → rot: beide („Abmelden: null")
 *   E  traegtSitzungsKeks() wieder auf `connect.sid` → rot: beide („die
 *      Herkunftsprüfung erkennt das Cookie")
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATABASE_URL = URL_DB;
const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const warte = (ms) => new Promise(r => setTimeout(r, ms));
const freierPort = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

const NAME = `keks_${process.pid}`, PASS = 'Keks-Passwort-1';

/** Der echte Server aus dist/, in Produktion; `env` entscheidet über TLS. */
async function starteServer(t, env) {
  const port = await freierPort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: URL_DB, SESSION_SECRET: 'keks-test-geheimnis-lang-genug-1234',
           PORT: String(port), ROLLE: 'web', NODE_ENV: 'production', DB_SUPERUSER_ERLAUBT: '1', APP_BASE_URL_FEHLT_OK: '1', ...env },
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
  return { basis, log: () => log };
}

/** Anmelden, mit dem Cookie fragen, wer man ist, abmelden. */
async function durchlauf(server, kopf) {
  const login = await fetch(`${server.basis}/api/v1/auth/login`, { method: 'POST',
    headers: { 'content-type': 'application/json', ...kopf },
    body: JSON.stringify({ username: NAME, password: PASS, ohne_token: true }) });
  assert.equal(login.status, 200, `${await login.text()}\n${server.log()}`);
  const setzen = login.headers.get('set-cookie');
  const cookie = setzen.split(';')[0];
  const ich = async () => (await fetch(`${server.basis}/api/v1/auth/me`, { headers: { cookie, ...kopf } })).json();
  const angemeldet = await ich();
  // Ein Bearer-Kopf daneben darf die Herkunftsprüfung nicht abschalten.
  const fremd = await fetch(`${server.basis}/api/v1/auth/logout`, { method: 'POST',
    headers: { cookie, ...kopf, authorization: 'Bearer x', 'sec-fetch-site': 'cross-site' } });
  await fremd.arrayBuffer();
  const ab = await fetch(`${server.basis}/api/v1/auth/logout`, { method: 'POST',
    headers: { cookie, ...kopf, 'sec-fetch-site': 'same-origin' } });
  await ab.arrayBuffer();
  return { setzen, cookie, angemeldet, fremd: fremd.status, loeschen: ab.headers.get('set-cookie'), danach: await ich() };
}

test('Sitzungscookie mit und ohne TLS', { concurrency: 1, timeout: 240_000 }, async (t) => {
  if (!await dbOderSkip(t, _req)) return;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  await db.run(`INSERT INTO users (username, password_hash, is_active, email_verified) VALUES ($1, $2, true, true)`,
    [NAME, bcrypt.hashSync(PASS, 4)]);
  await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE $1", [`%${NAME}%`]);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username = $1', [NAME]);
    await db.pool.end().catch(() => {});
  });

  await t.test('mit TLS: __Host-bim.sid, Secure, Path=/, ohne Domain', async () => {
    const server = await starteServer(t, {});
    const d = await durchlauf(server, { 'x-forwarded-proto': 'https' });
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
  });

  await t.test('ohne TLS: bim.sid ohne Präfix und ohne Secure', async () => {
    const server = await starteServer(t, { COOKIE_SECURE: '0' });
    const d = await durchlauf(server, {});
    assert.match(d.setzen, /^bim\.sid=/, d.setzen);
    assert.doesNotMatch(d.setzen, /Secure/i, d.setzen);
    assert.equal(d.angemeldet.loggedIn, true, 'die Anmeldung trägt');
    assert.equal(d.fremd, 403, 'die Herkunftsprüfung erkennt das Cookie');
    assert.match(d.loeschen ?? '', /^bim\.sid=;/, `Abmelden: ${d.loeschen}`);
    assert.equal(d.danach.loggedIn, false);
  });
});
