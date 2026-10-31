/**
 * Anmeldesperre: je Adresse UND je Benutzername — und die Adresse kommt nur
 * dann aus X-Forwarded-For, wenn ein vertrauter Proxy davorsteht.
 *
 * Gegenproben (am 25.10. gemessen):
 *   A  Zähler je Name in checkLoginAllowed entfernt → rot: „mit wechselnden
 *      Adressen unbegrenzt raten" (seit 28.10. je Konto mit wachsender Wartezeit)
 *   B  server.ts wieder mit `trust proxy` 1 statt proxyVertrauen() → rot:
 *      „TRUST_PROXY=false wird nicht beachtet"
 *   C  proxyVertrauen('') liefert true → rot: „öffentliche Adresse vertraut"
 *   D  (27.10.) Standard wieder mit uniquelocal → rot: „Heimnetz-Rechner vertraut"
 *   E  (27.10.) Ausnahme für bekannte Adressen entfernt → rot: „der Inhaber
 *      kommt von seiner bekannten Adresse weiter herein"
 *   G  (27.10.) app.disable('x-powered-by') entfernt → rot: „verrät X-Powered-By"
 *   J  (29.10.) Standard ohne TRUST_PROXY wieder das Docker-Netz → rot:
 *      „ohne TRUST_PROXY dem Docker-Netz vertraut: 172.18.0.2"
 *   K  (30.10.) proxyVertrauen nimmt wieder „docker" (172.16/12 ohne Gateway)
 *      an → rot: „angenommen: docker"; Präfixgrenze in proxyEintragGueltig
 *      entfernt → rot: „angenommen: 172.16.0.0/12"
 *   H  (28.10.) kontoKennung() liefert wieder den rohen Namen → rot: „Name
 *      und E-Mail zählen gemeinsam" (und der Zähler je Konto fehlt)
 *   I  (28.10.) wartezeitSekunden() fest auf 1 s → rot: „Sperre je
 *      Benutzername gilt über alle Adressen" (keine Verdoppelung)
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
const { proxyVertrauen } = _req('src/infra/proxyVertrauen.js');
const { MAX_ATTEMPTS, wartezeitSekunden } = _req('utils/loginLimiter.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const bcrypt  = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAME = `sperre_${process.pid}`, PASS = 'richtigesPasswort1';
const warte = (ms) => new Promise(r => setTimeout(r, ms));

let UID = null;
/** Schlüssel des Zählers je Konto (Name und E-Mail zählen gemeinsam). */
const kontoSchluessel = () => `login-name|konto:${UID}`;
const zaehlerLeeren = () => db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1 OR key LIKE $2',
  [`%${NAME}%`, `%konto:${UID}`]);

test.after(async () => {
  await db.run('DELETE FROM users WHERE username = $1', [NAME]).catch(() => {});
  await zaehlerLeeren().catch(() => {});
  await db.pool.end().catch(() => {});
});

async function vorbereiten(t) {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return false;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  UID = (await db.get(
    'INSERT INTO users (username, email, password_hash, is_active, email_verified) VALUES ($1, $2, $3, 1, 1) RETURNING id',
    [NAME, `${NAME}@example.org`, await bcrypt.hash(PASS, 4)])).id;
  await zaehlerLeeren();
  return true;
}

test('proxyVertrauen: wem X-Forwarded-For geglaubt wird', () => {
  const vertraut = (einstellung, adresse) => {
    const app = express();
    app.set('trust proxy', proxyVertrauen(einstellung));
    return app.get('trust proxy fn')(adresse, 0);
  };
  // Ohne Angabe nur Loopback: Ausserhalb von Docker ist 172.16/12 ein Netz wie jedes andere.
  for (const eigen of ['127.0.0.1', '127.8.9.10', '::1', '::ffff:127.0.0.1'])
    assert.equal(vertraut(undefined, eigen), true, `${eigen} ist der eigene Proxy`);
  for (const netz of ['172.18.0.2', '172.31.255.1', 'fd00::5'])
    assert.equal(vertraut(undefined, netz), false, `ohne TRUST_PROXY dem Docker-Netz vertraut: ${netz}`);
  // Eine feste Proxy-Adresse im Compose-Netz: genau diese, nicht ihre Nachbarn
  // und nicht das Gateway, über das Clients selbst hereinkommen.
  assert.equal(vertraut('172.28.73.10', '172.28.73.10'), true, 'der eingetragene Proxy');
  assert.equal(vertraut('172.28.73.10', '::ffff:172.28.73.10'), true, 'auch in der IPv6-Hülle');
  for (const nachbar of ['172.28.73.11', '172.28.73.1', '172.18.0.2', '127.0.0.1'])
    assert.equal(vertraut('172.28.73.10', nachbar), false, `nicht eingetragen und doch vertraut: ${nachbar}`);
  // Ganze Netze, Hop-Zahlen und Freibriefe verweigern den Start.
  for (const falsch of ['docker', 'true', '1', '2', '172.16.0.0/12', '10.0.0.0/8', '0.0.0.0/0', '::/0',
                        'fd00::/8', 'uniquelocal', 'proxy.example.org', '192.168.1.5/33', '172.28.73.10, docker'])
    assert.throws(() => proxyVertrauen(falsch), /TRUST_PROXY enthält/, `angenommen: ${falsch}`);
  assert.deepEqual(proxyVertrauen('172.28.73.10, 192.168.1.0/24 fd00::7'), ['172.28.73.10', '192.168.1.0/24', 'fd00::7']);
  for (const fremd of ['203.0.113.5', '8.8.8.8', '2001:db8::1'])
    assert.equal(vertraut(undefined, fremd), false, `öffentliche Adresse vertraut: ${fremd}`);
  // Rechner im Heimnetz geben ihre Adresse nicht selbst an.
  for (const lan of ['192.168.1.10', '10.1.2.3', '169.254.1.1'])
    assert.equal(vertraut(undefined, lan), false, `Heimnetz-Rechner vertraut: ${lan}`);
  assert.equal(vertraut('192.168.1.5', '192.168.1.5'), true, 'ein Proxy im Heimnetz lässt sich nennen');
  assert.equal(vertraut('false', '127.0.0.1'), false);
  assert.equal(vertraut('203.0.113.5', '203.0.113.5'), true);
  assert.equal(vertraut('203.0.113.5', '127.0.0.1'), false);
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
  // Je Konto: Ab MAX_ATTEMPTS Fehlversuchen wartet auch jede andere Adresse.
  assert.equal(await anmelden(PASS, '198.51.100.2'), 429,
    'mit wechselnden Adressen unbegrenzt raten — der Zähler je Konto fehlt');
  // Ist die Wartezeit um, geht es weiter — und sie verdoppelt sich.
  const zurueck = (sek) => db.run(
    `UPDATE rate_limit_attempts SET last_at = NOW() - make_interval(secs => $2) WHERE key = $1`,
    [kontoSchluessel(), sek]);
  assert.equal(wartezeitSekunden(MAX_ATTEMPTS), 1);
  assert.equal(wartezeitSekunden(MAX_ATTEMPTS + 1), 2);
  await zurueck(wartezeitSekunden(MAX_ATTEMPTS) + 0.5);
  assert.equal(await anmelden('falsch', '198.51.100.3'), 401, 'nach Ablauf der Wartezeit darf es weitergehen');
  await zurueck(wartezeitSekunden(MAX_ATTEMPTS) + 0.5);
  assert.equal(await anmelden(PASS, '198.51.100.4'), 429, 'die Wartezeit wächst nicht');

  // Nach der Wartezeit gilt das richtige Passwort und räumt den Zähler ab.
  await zurueck(wartezeitSekunden(MAX_ATTEMPTS + 1) + 0.5);
  assert.equal(await anmelden(PASS, '198.51.100.5'), 200);
  const rest = await db.get('SELECT count FROM rate_limit_attempts WHERE key = $1', [kontoSchluessel()]);
  assert.equal(rest, undefined, 'erfolgreiche Anmeldung leert den Zähler je Konto nicht');
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
  const anmelden = async (password, ip, name = NAME) => (await fetch(`http://127.0.0.1:${srv.address().port}${AUTH}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ username: name, password }),
  })).status;

  assert.equal(await anmelden(PASS, '198.51.100.7'), 200, 'Vorbedingung: der Inhaber war schon einmal da');
  // Ein Angreifer verteilt seine Fehlversuche — über Name UND E-Mail.
  for (let i = 0; i < MAX_ATTEMPTS; i++)
    assert.equal(await anmelden('falsch', `203.0.113.${i + 1}`, i % 2 ? `${NAME}@example.org` : NAME), 401,
      `Versuch ${i + 1}`);
  assert.equal(await anmelden(PASS, '203.0.113.200'), 429,
    'eine unbekannte Adresse wartet — Name und E-Mail zählen gemeinsam');
  assert.equal(await anmelden(PASS, '198.51.100.7'), 200,
    'der Inhaber kommt von seiner bekannten Adresse weiter herein');
});

test('server.ts: TRUST_PROXY=false — X-Forwarded-For wird ignoriert', { concurrency: 1, timeout: 120_000 }, async (t) => {
  if (!await vorbereiten(t)) return;
  for (const k of ['rb_csv_last_sync', 'rb_part_categories_last_sync', 'rb_catalog_extras_last_sync'])
    await db.run(`INSERT INTO laufzustand (schluessel, wert) VALUES ($1, to_char(NOW(), 'YYYY-MM-DD'))
                  ON CONFLICT (schluessel) DO UPDATE SET wert = EXCLUDED.wert`, [k]);
  const port = await new Promise((auf) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => auf(p)); });
  });
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: URL_DB, SESSION_SECRET: 'sperre-test-geheimnis-lang-genug-1234',
           PORT: String(port), NODE_ENV: 'production', TRUST_PROXY: 'false' },
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
  for (let i = 0; i < 240 && !/localhost:\d+|Startup complete/.test(log); i++) await warte(250);
  for (let i = 0; i < 40 && (await fetch(`http://127.0.0.1:${port}/api/v1/`).catch(() => null)) === null; i++) await warte(250);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/`)).headers.get('x-powered-by'), null,
    'Der Server verrät X-Powered-By');

  // Wechselnde X-Forwarded-For, aber derselbe Absender: Ohne Vertrauen zählt
  // alles auf 127.0.0.1, die Sperre greift nach MAX_ATTEMPTS.
  for (let i = 0; i < MAX_ATTEMPTS; i++) assert.equal(await anmelden('falsch', `198.51.100.${i + 1}`), 401, log.slice(-1500));
  assert.equal(await anmelden(PASS, '198.51.100.99'), 429, 'TRUST_PROXY=false wird nicht beachtet');
});
