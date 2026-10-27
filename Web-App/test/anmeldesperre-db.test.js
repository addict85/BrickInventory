/**
 * Anmeldesperre: je Adresse UND je Benutzername — und die Adresse kommt nur
 * dann aus X-Forwarded-For, wenn ein vertrauter Proxy davorsteht.
 *
 * Gegenproben (am 25.10. gemessen):
 *   A  Zähler je Name in checkLoginAllowed entfernt → rot: „mit wechselnden
 *      Adressen unbegrenzt raten"
 *   B  server.ts wieder mit `trust proxy` 1 statt proxyVertrauen() → rot:
 *      „TRUST_PROXY=false wird nicht beachtet"
 *   C  proxyVertrauen('') liefert true → rot: „öffentliche Adresse vertraut"
 *   D  (27.10.) Standard wieder mit uniquelocal → rot: „Heimnetz-Rechner vertraut"
 *   E  (27.10.) Ausnahme für bekannte Adressen entfernt → rot: „der Inhaber
 *      kommt von seiner bekannten Adresse weiter herein"
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const net    = require('node:net');
const { spawn } = require('node:child_process');

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATABASE_URL = URL_DB;
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const AUTH = require('./helpers/sources').einhaengung('auth');
const db = _req('db/database.js');
const { proxyVertrauen } = _req('utils/proxyVertrauen.js');
const { MAX_ATTEMPTS, MAX_JE_NAME } = _req('utils/loginLimiter.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const bcrypt  = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAME = `sperre_${process.pid}`, PASS = 'richtigesPasswort1';
const warte = (ms) => new Promise(r => setTimeout(r, ms));

test.after(async () => {
  await db.run('DELETE FROM users WHERE username = $1', [NAME]).catch(() => {});
  await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', [`%${NAME}%`]).catch(() => {});
  await db.pool.end().catch(() => {});
});

async function vorbereiten(t) {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return false;
  }
  await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', [`%${NAME}%`]);
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  await db.run('INSERT INTO users (username, password_hash, is_active, email_verified) VALUES ($1, $2, 1, 1)',
    [NAME, await bcrypt.hash(PASS, 4)]);
  return true;
}

test('proxyVertrauen: wem X-Forwarded-For geglaubt wird', () => {
  const vertraut = (einstellung, adresse) => {
    const app = express();
    app.set('trust proxy', proxyVertrauen(einstellung));
    return app.get('trust proxy fn')(adresse, 0);
  };
  for (const eigen of ['127.0.0.1', '::1', '172.18.0.2', '172.31.255.1', 'fd00::5'])
    assert.equal(vertraut(undefined, eigen), true, `${eigen} ist der eigene Proxy`);
  for (const fremd of ['203.0.113.5', '8.8.8.8', '2001:db8::1'])
    assert.equal(vertraut(undefined, fremd), false, `öffentliche Adresse vertraut: ${fremd}`);
  // Rechner im Heimnetz geben ihre Adresse nicht selbst an.
  for (const lan of ['192.168.1.10', '10.1.2.3', '169.254.1.1'])
    assert.equal(vertraut(undefined, lan), false, `Heimnetz-Rechner vertraut: ${lan}`);
  assert.equal(vertraut('192.168.1.5', '192.168.1.5'), true, 'ein Proxy im Heimnetz lässt sich nennen');
  assert.equal(vertraut('false', '127.0.0.1'), false);
  assert.equal(vertraut('203.0.113.5', '203.0.113.5'), true);
  assert.equal(vertraut('203.0.113.5', '127.0.0.1'), false);
  assert.equal(vertraut('1', '203.0.113.5'), true);
});

test('Sperre je Benutzername gilt über alle Adressen', { concurrency: 1 }, async (t) => {
  if (!await vorbereiten(t)) return;
  const app = express();
  app.set('trust proxy', proxyVertrauen(undefined));   // Anfragen kommen von 127.0.0.1
  app.use(express.json());
  app.use(AUTH, _req('routes/auth.js'));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const anmelden = async (password, ip) => (await fetch(`http://127.0.0.1:${srv.address().port}${AUTH}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ username: NAME, password }),
  })).status;

  // Je Adresse: nach MAX_ATTEMPTS ist für diese Adresse Schluss.
  for (let i = 0; i < MAX_ATTEMPTS; i++) assert.equal(await anmelden('falsch', '198.51.100.1'), 401);
  assert.equal(await anmelden(PASS, '198.51.100.1'), 429, 'keine Sperre je Adresse');
  // Von einer anderen Adresse geht es weiter — bis zur Grenze je Name.
  for (let i = MAX_ATTEMPTS; i < MAX_JE_NAME; i++)
    assert.equal(await anmelden('falsch', `198.51.100.${i + 2}`), 401, `Versuch ${i + 1}`);
  assert.equal(await anmelden(PASS, '198.51.100.250'), 429,
    'mit wechselnden Adressen unbegrenzt raten — der Zähler je Name fehlt');

  // Nach dem Fenster (hier: Zähler geleert) gilt das richtige Passwort wieder
  // und räumt den Zähler je Name ab.
  await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', [`login|%${NAME}%`]);
  await db.run(`UPDATE rate_limit_attempts SET count = $2 WHERE key = $1`, [`login-name|${NAME}`, MAX_JE_NAME - 1]);
  assert.equal(await anmelden(PASS, '198.51.100.251'), 200);
  const rest = await db.get('SELECT count FROM rate_limit_attempts WHERE key = $1', [`login-name|${NAME}`]);
  assert.equal(rest, undefined, 'erfolgreiche Anmeldung leert den Zähler je Name nicht');
});

test('die Sperre je Name sperrt den Inhaber nicht aus', { concurrency: 1 }, async (t) => {
  if (!await vorbereiten(t)) return;
  await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', [`%${NAME}%`]);
  const app = express();
  app.set('trust proxy', proxyVertrauen(undefined));
  app.use(express.json());
  app.use(AUTH, _req('routes/auth.js'));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const anmelden = async (password, ip) => (await fetch(`http://127.0.0.1:${srv.address().port}${AUTH}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ username: NAME, password }),
  })).status;

  assert.equal(await anmelden(PASS, '198.51.100.7'), 200, 'Vorbedingung: der Inhaber war schon einmal da');
  // Ein Angreifer verteilt seine Fehlversuche, bis der Name gesperrt ist.
  for (let i = 0; i < MAX_JE_NAME; i++)
    assert.equal(await anmelden('falsch', `203.0.113.${i + 1}`), 401, `Versuch ${i + 1}`);
  assert.equal(await anmelden(PASS, '203.0.113.200'), 429, 'eine unbekannte Adresse bleibt gesperrt');
  assert.equal(await anmelden(PASS, '198.51.100.7'), 200,
    'der Inhaber kommt von seiner bekannten Adresse weiter herein');
});

test('server.ts: TRUST_PROXY=false — X-Forwarded-For wird ignoriert', { concurrency: 1, timeout: 120_000 }, async (t) => {
  if (!await vorbereiten(t)) return;
  for (const k of ['rb_csv_last_sync', 'rb_part_categories_last_sync', 'rb_catalog_extras_last_sync'])
    await db.run(`INSERT INTO global_settings (key, value) VALUES ($1, to_char(NOW(), 'YYYY-MM-DD'))
                  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [k]);
  const port = await new Promise((auf) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => auf(p)); });
  });
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: URL_DB, SESSION_SECRET: 'sperre-test-geheimnis-lang-genug-1234',
           PORT: String(port), WEB_WORKERS: '1', NODE_ENV: 'production', TRUST_PROXY: 'false' },
  });
  let log = '';
  srv.stdout.on('data', d => { log += d; });
  srv.stderr.on('data', d => { log += d; });
  t.after(async () => {
    srv.kill('SIGTERM');
    for (let i = 0; i < 40 && srv.exitCode === null && srv.signalCode === null; i++) await warte(100);
    if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGKILL');
  });
  const anmelden = async (password, ip) => {
    try {
      return (await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ username: NAME, password }),
      })).status;
    } catch { return 0; }
  };
  for (let i = 0; i < 240 && !/is PRIMARY|Startup complete/.test(log); i++) await warte(250);
  for (let i = 0; i < 40 && (await fetch(`http://127.0.0.1:${port}/api/v1/`).catch(() => null)) === null; i++) await warte(250);

  // Wechselnde X-Forwarded-For, aber derselbe Absender: Ohne Vertrauen zählt
  // alles auf 127.0.0.1, die Sperre greift nach MAX_ATTEMPTS.
  for (let i = 0; i < MAX_ATTEMPTS; i++) assert.equal(await anmelden('falsch', `198.51.100.${i + 1}`), 401, log.slice(-1500));
  assert.equal(await anmelden(PASS, '198.51.100.99'), 429, 'TRUST_PROXY=false wird nicht beachtet');
});
