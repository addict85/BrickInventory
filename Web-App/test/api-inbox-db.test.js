/**
 * Under /api/v1 exactly what is meant for it is reachable without login
 * (log in, register, reset, design, startup state) — every other
 * route answers 401, even one that forgot its own protection.
 * Measured on the real server: every route from the source text is called
 * without credentials.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  loginAtInbox not mounted in server.ts and requireToken removed from
 *      GET /stats (routes/api_v1/misc.ts) → red: “only the
 *      public paths answer without login” (GET /api/v1/stats open)
 *      and “a wrong token does not get in”. With the entrance but
 *      without the protection on /stats everything stays green — that is the purpose.
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
const { buildAndRequire, v1Routes, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { warte } = require('./helpers/time');
const { portOf } = require('./helpers/server');

/** Deliberately reachable without login — with a reason. If the list grows, someone must justify it. */
const EXPECTED_OPEN = new Map([
  ['POST /api/v1/auth/login', 'Die Anmeldung selbst'],
  ['POST /api/v1/auth/logout', 'Muss auch ohne gültige Sitzung gehen'],
  ['GET /api/v1/auth/me', 'Antwortet „nicht angemeldet" — der Startpunkt der Oberfläche'],
  ['POST /api/v1/auth/qr-login', 'Anmeldung per QR-Code'],
  ['POST /api/v1/auth/qr-login/abholen', 'Die App holt nach der Bestätigung im Browser ihren Zugang ab'],
  ['POST /api/v1/auth/qr-login/verwerfen', 'Das Nein der App auf dem QR-Bildschirm, vor jedem Token'],
  ['GET /api/v1/auth/registration-status', 'Ob Registrierung offen ist — vor dem Konto'],
  ['POST /api/v1/auth/forgot-password', 'Wer sein Passwort vergisst, kann sich nicht anmelden'],
  ['POST /api/v1/auth/bestaetigung-erneut', 'Ein unbestätigtes Konto kann sich nicht anmelden'],
  ['POST /api/v1/auth/reset-password', 'Dasselbe, zweiter Schritt'],
  ['POST /api/v1/auth/uebernahme-abbrechen', 'Der Link aus der Mail: Das Ziel ist deaktiviert oder abgemeldet'],
  ['POST /api/v1/auth/anmeldung-freigeben', 'Der Link aus der Mail: Die Anmeldung ist gerade gesperrt'],
  ['POST /api/v1/auth/email-bestaetigen', 'Wer seine Adresse bestätigt, ist noch nicht angemeldet'],
  ['POST /api/v1/auth/email-bestaetigen/vorschau', 'Dasselbe, vor dem Bestätigen'],
  ['POST /api/v1/auth/passkey/anmelden/optionen', 'Die Anmeldung mit Passkey beginnt vor jedem Konto'],
  ['GET /api/v1/settings/theme', 'Das Design des Login-Bildschirms, vor jeder Anmeldung'],
  ['GET /api/v1/einrichtung/stand', 'Was vor dem ersten Konto fehlt — die Anmeldeseite fragt es ab'],
  ['GET /api/v1/startup-status', 'Der Ladebildschirm vor der Anmeldung'],
  ['GET /api/v1/health', 'Status für Überwachung, Details nur für Verwalter'],
  ['GET /api/v1/health/live', 'Lebenszeichen des Prozesses'],
  ['GET /api/v1/health/ready', 'Gesundheitsprüfung von compose.yaml (Datenbank)'],
]);

const freePort = () =>
  new Promise(r => {
    const s = net.createServer().listen(0, () => {
      const p = portOf(s);
      s.close(() => r(p));
    });
  });

test('entrance to /api/v1', { concurrency: 1, timeout: 180_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  t.after(() => db.pool.end().catch(() => {}));

  const port = await freePort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DATABASE_URL: URL_DB,
      SESSION_SECRET: 'eingang-test-geheimnis-lang-genug-1234',
      PORT: String(port),
      TRUST_PROXY: 'false',
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
  for (let i = 0; i < 240 && !/localhost:\d+|Startup complete/.test(log); i++) await warte(250);
  for (let i = 0; i < 40 && (await fetch(`http://127.0.0.1:${port}/api/v1/health`).catch(() => null)) === null; i++)
    await warte(250);

  const alle = v1Routes();
  assert.ok(alle.length > 150, `nur ${alle.length} Routen gefunden — greift die Suche noch?`);
  const offen = new Set();
  for (const [m, p] of alle) {
    const url = p.replace(/:[A-Za-z_]+\??/g, '1').replace(/\*[a-z]+/g, 'a');
    // Empty body: a public endpoint then answers 400, but not 401.
    const r = await fetch(`http://127.0.0.1:${port}${url}`, {
      method: m,
      redirect: 'manual',
      headers: { 'content-type': 'application/json' },
      body: m === 'GET' ? undefined : '{}',
    });
    await r.arrayBuffer();
    // /auth/register is public but answers 403 as long as registration
    // is off — that depends on a setting other tests toggle.
    if (r.status !== 401 && r.status !== 403 && p !== '/api/v1/auth/register') offen.add(`${m} ${p}`);
  }

  await t.test('only the public paths answer without login', () =>
    assert.deepEqual([...offen].sort(), [...EXPECTED_OPEN.keys()].sort()),
  );

  await t.test('a wrong token does not get in', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/v1/stats`, { headers: { authorization: 'Bearer falsch' } });
    assert.equal(r.status, 401);
  });
});
