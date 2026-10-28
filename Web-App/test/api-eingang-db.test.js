/**
 * Unter /api/v1 ist ohne Anmeldung genau das erreichbar, was dazu gedacht ist
 * (Anmelden, Registrieren, Zurücksetzen, Design, Startzustand) — jede andere
 * Route antwortet 401, auch eine, die ihren eigenen Schutz vergessen hat.
 * Gemessen am echten Server: Jede Route aus dem Quelltext wird ohne Ausweis
 * aufgerufen.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  anmeldungAmEingang in server.ts nicht eingehängt und requireToken aus
 *      GET /stats (routes/api_v1/misc.ts) entfernt → rot: „nur die
 *      öffentlichen Pfade antworten ohne Anmeldung“ (GET /api/v1/stats offen)
 *      und „ein falsches Token kommt nicht hinein“. Mit dem Eingang, aber
 *      ohne den Schutz an /stats bleibt alles grün — das ist der Zweck.
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
const { buildAndRequire, v1Routen } = require('./helpers/sources');
const _req = buildAndRequire();
const db = _req('db/database.js');
const warte = (ms) => new Promise(r => setTimeout(r, ms));

/** Absichtlich ohne Anmeldung erreichbar — mit Grund. Wächst die Liste, muss jemand sie begründen. */
const ERWARTET_OFFEN = new Map([
  ['POST /api/v1/auth/login',            'Die Anmeldung selbst'],
  ['POST /api/v1/auth/logout',           'Muss auch ohne gültige Sitzung gehen'],
  ['GET /api/v1/auth/me',                'Antwortet „nicht angemeldet" — der Startpunkt der Oberfläche'],
  ['POST /api/v1/auth/qr-login',         'Anmeldung per QR-Code'],
  ['POST /api/v1/auth/serverbeweis',     'Die App prüft den Server, BEVOR sie ihren Token sendet'],
  ['GET /api/v1/auth/registration-status', 'Ob Registrierung offen ist — vor dem Konto'],
  ['POST /api/v1/auth/forgot-password',  'Wer sein Passwort vergisst, kann sich nicht anmelden'],
  ['POST /api/v1/auth/reset-password',   'Dasselbe, zweiter Schritt'],
  ['GET /api/v1/settings/theme',         'Das Design des Login-Bildschirms, vor jeder Anmeldung'],
  ['GET /api/v1/startup-status',         'Der Ladebildschirm vor der Anmeldung'],
  ['GET /api/v1/health',                 'Gesundheitsprüfung von compose.yaml'],
]);

const freierPort = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

test('Eingang zu /api/v1', { concurrency: 1, timeout: 180_000 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  t.after(() => db.pool.end().catch(() => {}));

  const port = await freierPort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: URL_DB, SESSION_SECRET: 'eingang-test-geheimnis-lang-genug-1234',
           PORT: String(port), WEB_WORKERS: '1', TRUST_PROXY: 'false' },
  });
  let log = '';
  srv.stdout.on('data', d => { log += d; });
  srv.stderr.on('data', d => { log += d; });
  t.after(async () => {
    srv.kill('SIGTERM');
    for (let i = 0; i < 40 && srv.exitCode === null && srv.signalCode === null; i++) await warte(100);
    if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGKILL');
  });
  for (let i = 0; i < 240 && !/is PRIMARY|Startup complete/.test(log); i++) await warte(250);
  for (let i = 0; i < 40 && (await fetch(`http://127.0.0.1:${port}/api/v1/health`).catch(() => null)) === null; i++) await warte(250);

  const alle = v1Routen();
  assert.ok(alle.length > 150, `nur ${alle.length} Routen gefunden — greift die Suche noch?`);
  const offen = new Set();
  for (const [m, p] of alle) {
    const url = p.replace(/:[A-Za-z_]+\??/g, '1').replace(/\*[a-z]+/g, 'a');
    // Leerer Körper: Ein öffentlicher Endpunkt antwortet dann 400, aber nicht 401.
    const r = await fetch(`http://127.0.0.1:${port}${url}`, {
      method: m, redirect: 'manual', headers: { 'content-type': 'application/json' },
      body: m === 'GET' ? undefined : '{}' });
    await r.arrayBuffer();
    // /auth/register ist öffentlich, antwortet aber 403, solange die Registrierung
    // aus ist — das hängt an einer Einstellung, die andere Tests umschalten.
    if (r.status !== 401 && r.status !== 403 && p !== '/api/v1/auth/register') offen.add(`${m} ${p}`);
  }

  await t.test('nur die öffentlichen Pfade antworten ohne Anmeldung', () =>
    assert.deepEqual([...offen].sort(), [...ERWARTET_OFFEN.keys()].sort()));

  await t.test('ein falsches Token kommt nicht hinein', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/v1/stats`, { headers: { authorization: 'Bearer falsch' } });
    assert.equal(r.status, 401);
  });
});
