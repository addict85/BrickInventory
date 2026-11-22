/**
 * Login lock: per address AND per username — and the address only comes
 * from X-Forwarded-For when a trusted proxy stands in front.
 *
 * Counter-checks (measured on 25.10.):
 *   A  counter per name removed in loginAllowed → red: „mit wechselnden
 *      Adressen unbegrenzt raten" (since 28.10. per account with growing wait time)
 *   B  server.ts again with `trust proxy` 1 instead of proxyTrust() → red:
 *      „TRUST_PROXY=false wird nicht beachtet"
 *   C  proxyTrust('') delivers true → red: „öffentliche Adresse vertraut"
 *   D  (27.10.) default again with uniquelocal → red: „Heimnetz-Rechner vertraut"
 *   E  (27.10.) exception for known addresses removed → red: „der Inhaber
 *      kommt von seiner bekannten Adresse weiter herein"
 *   G  (27.10.) app.disable('x-powered-by') removed → red: „verrät X-Powered-By"
 *   J  (29.10.) default without TRUST_PROXY again the Docker network → red:
 *      „ohne TRUST_PROXY dem Docker-Netz vertraut: 172.18.0.2"
 *   K  (30.10.) proxyTrust again accepts „docker" (172.16/12 without gateway)
 *      → red: „angenommen: docker"; prefix limit in proxyEntryValid
 *      removed → red: „angenommen: 172.16.0.0/12"
 *   L  (14.11.2026) in proxyEntryValid the narrow limit again /16 or /64 → red:
 *      „ohne Bestätigung angenommen: 192.168.1.0/24“
 *   M  (14.11.2026) the confirmation allows everything (`p <= max`) → red: „bestätigt
 *      angenommen: 172.16.0.0/12“
 *   H  (28.10.) accountKey() again delivers the raw name → red: „Name
 *      und E-Mail zählen gemeinsam" (and the counter per account is missing)
 *   I  (28.10.) waitTimeSeconds() fixed at 1 s → red: “lock per
 *      username applies across all addresses” (no doubling)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATABASE_URL = URL_DB;
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const AUTH = require('./helpers/sources').einhaengung('auth');
const db = testData();
const { proxyTrust } = _req('src/infra/proxyTrust.js');
const { MAX_ATTEMPTS, waitTimeSeconds } = _req('src/account/loginLimiter.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAME = `sperre_${process.pid}`,
  PASS = 'richtigesPasswort1';
const { warte } = require('./helpers/time');
const { portOf } = require('./helpers/server');

let UID = null;
/** Key of the counter per account (name and email count together). */
const accountKey = () => `login-name|konto:${UID}`;
const clearCounter = () =>
  db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1 OR key LIKE $2', [`%${NAME}%`, `%konto:${UID}`]);

test.after(async () => {
  await db.run('DELETE FROM users WHERE username = $1', [NAME]).catch(() => {});
  await clearCounter().catch(() => {});
  await db.pool.end().catch(() => {});
});

async function prepare(t) {
  try {
    await db.initSchema();
  } catch (e) {
    keineDb(t, e);
    return false;
  }
  const c = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(c);
  } finally {
    c.release();
  }
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  UID = (
    await db.get(
      'INSERT INTO users (username, email, password_hash, is_active, email_verified) VALUES ($1, $2, $3, true, true) RETURNING id',
      [NAME, `${NAME}@example.org`, await bcrypt.hash(PASS, 4)],
    )
  ).id;
  await clearCounter();
  return true;
}

test('proxyTrust: whom X-Forwarded-For is believed', () => {
  const vertraut = (setting, address) => {
    const app = express();
    app.set('trust proxy', proxyTrust(setting));
    return app.get('trust proxy fn')(address, 0);
  };
  // Without a setting only loopback: outside of Docker 172.16/12 is a network like any other.
  for (const eigen of ['127.0.0.1', '127.8.9.10', '::1', '::ffff:127.0.0.1'])
    assert.equal(vertraut(undefined, eigen), true, `${eigen} ist der eigene Proxy`);
  for (const netz of ['172.18.0.2', '172.31.255.1', 'fd00::5'])
    assert.equal(vertraut(undefined, netz), false, `ohne TRUST_PROXY dem Docker-Netz vertraut: ${netz}`);
  // A fixed proxy address in the Compose network: exactly this one, not its neighbors
  // and not the gateway through which clients come in themselves.
  assert.equal(vertraut('172.28.73.10', '172.28.73.10'), true, 'der eingetragene Proxy');
  assert.equal(vertraut('172.28.73.10', '::ffff:172.28.73.10'), true, 'auch in der IPv6-Hülle');
  for (const neighbor of ['172.28.73.11', '172.28.73.1', '172.18.0.2', '127.0.0.1'])
    assert.equal(vertraut('172.28.73.10', neighbor), false, `nicht eingetragen und doch vertraut: ${neighbor}`);
  // Whole networks, hop counts and blank checks refuse the start.
  for (const falsch of [
    'docker',
    'true',
    '1',
    '2',
    '172.16.0.0/12',
    '10.0.0.0/8',
    '0.0.0.0/0',
    '::/0',
    'fd00::/8',
    'uniquelocal',
    'proxy.example.org',
    '192.168.1.5/33',
    '172.28.73.10, docker',
  ])
    assert.throws(() => proxyTrust(falsch), /TRUST_PROXY enthält/, `angenommen: ${falsch}`);
  assert.deepEqual(proxyTrust('172.28.73.10, 192.168.1.8/29 fd00::7 fd00::100/120'), [
    '172.28.73.10',
    '192.168.1.8/29',
    'fd00::7',
    'fd00::100/120',
  ]);
  // A network above eight addresses only when confirmed, and even then at most /16 or /64.
  for (const weit of ['192.168.1.0/24', '172.18.0.0/16', '192.168.1.0/28', 'fd00::/64', 'fd00::/119']) {
    assert.throws(() => proxyTrust(weit), /PROXY_NETWORK_CONFIRMED=1/, `ohne Bestätigung angenommen: ${weit}`);
    assert.deepEqual(proxyTrust(weit, true), [weit]);
  }
  for (const toWide of ['172.16.0.0/12', 'fd00::/48'])
    assert.throws(() => proxyTrust(toWide, true), /TRUST_PROXY enthält/, `bestätigt angenommen: ${toWide}`);
  for (const fremd of ['203.0.113.5', '8.8.8.8', '2001:db8::1'])
    assert.equal(vertraut(undefined, fremd), false, `öffentliche Adresse vertraut: ${fremd}`);
  // Computers in the home network do not state their address themselves.
  for (const lan of ['192.168.1.10', '10.1.2.3', '169.254.1.1'])
    assert.equal(vertraut(undefined, lan), false, `Heimnetz-Rechner vertraut: ${lan}`);
  assert.equal(vertraut('192.168.1.5', '192.168.1.5'), true, 'ein Proxy im Heimnetz lässt sich nennen');
  assert.equal(vertraut('false', '127.0.0.1'), false);
  assert.equal(vertraut('203.0.113.5', '203.0.113.5'), true);
  assert.equal(vertraut('203.0.113.5', '127.0.0.1'), false);
});

test('lock per username applies across all addresses', { concurrency: 1 }, async t => {
  if (!(await prepare(t))) return;
  const app = express();
  app.set('trust proxy', proxyTrust(undefined)); // Requests come from 127.0.0.1
  app.use(express.json());
  app.use(AUTH, require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const anmelden = async (password, ip) =>
    (
      await fetch(`http://127.0.0.1:${srv.address().port}${AUTH}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ username: NAME, password }),
      })
    ).status;

  // Per address: after MAX_ATTEMPTS it is over for this address.
  for (let i = 0; i < MAX_ATTEMPTS; i++) assert.equal(await anmelden('falsch', '198.51.100.1'), 401);
  assert.equal(await anmelden(PASS, '198.51.100.1'), 429, 'keine Sperre je Adresse');
  // Per account: from MAX_ATTEMPTS failed attempts on every other address waits too.
  assert.equal(
    await anmelden(PASS, '198.51.100.2'),
    429,
    'mit wechselnden Adressen unbegrenzt raten — der Zähler je Konto fehlt',
  );
  // Once the wait time is over, it continues — and it doubles.
  const zurueck = sek =>
    db.run(`UPDATE rate_limit_attempts SET last_at = NOW() - make_interval(secs => $2) WHERE key = $1`, [
      accountKey(),
      sek,
    ]);
  assert.equal(waitTimeSeconds(MAX_ATTEMPTS), 1);
  assert.equal(waitTimeSeconds(MAX_ATTEMPTS + 1), 2);
  await zurueck(waitTimeSeconds(MAX_ATTEMPTS) + 0.5);
  assert.equal(await anmelden('falsch', '198.51.100.3'), 401, 'nach Ablauf der Wartezeit darf es weitergehen');
  await zurueck(waitTimeSeconds(MAX_ATTEMPTS) + 0.5);
  assert.equal(await anmelden(PASS, '198.51.100.4'), 429, 'die Wartezeit wächst nicht');

  // After the wait time the right password counts and clears the counter.
  await zurueck(waitTimeSeconds(MAX_ATTEMPTS + 1) + 0.5);
  assert.equal(await anmelden(PASS, '198.51.100.5'), 200);
  const rest = await db.get('SELECT count FROM rate_limit_attempts WHERE key = $1', [accountKey()]);
  assert.equal(rest, undefined, 'erfolgreiche Anmeldung leert den Zähler je Konto nicht');
});

test('the lock per name does not lock out the owner', { concurrency: 1 }, async t => {
  if (!(await prepare(t))) return;
  await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', [`%${NAME}%`]);
  const app = express();
  app.set('trust proxy', proxyTrust(undefined));
  app.use(express.json());
  app.use(AUTH, require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const anmelden = async (password, ip, name = NAME) =>
    (
      await fetch(`http://127.0.0.1:${srv.address().port}${AUTH}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ username: name, password }),
      })
    ).status;

  assert.equal(await anmelden(PASS, '198.51.100.7'), 200, 'Vorbedingung: der Inhaber war schon einmal da');
  // An attacker distributes his failed attempts — across name AND email.
  for (let i = 0; i < MAX_ATTEMPTS; i++)
    assert.equal(
      await anmelden('falsch', `203.0.113.${i + 1}`, i % 2 ? `${NAME}@example.org` : NAME),
      401,
      `Versuch ${i + 1}`,
    );
  assert.equal(
    await anmelden(PASS, '203.0.113.200'),
    429,
    'eine unbekannte Adresse wartet — Name und E-Mail zählen gemeinsam',
  );
  assert.equal(
    await anmelden(PASS, '198.51.100.7'),
    200,
    'der Inhaber kommt von seiner bekannten Adresse weiter herein',
  );
});

test('server.ts: TRUST_PROXY=false — X-Forwarded-For is ignored', { concurrency: 1, timeout: 120_000 }, async t => {
  if (!(await prepare(t))) return;
  for (const k of ['rb_csv_last_sync', 'rb_part_categories_last_sync', 'rb_catalog_extras_last_sync'])
    await db.run(
      `INSERT INTO run_state (key, value) VALUES ($1, to_char(NOW(), 'YYYY-MM-DD'))
                  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [k],
    );
  const port = await new Promise(auf => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = portOf(s);
      s.close(() => auf(p));
    });
  });
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DATABASE_URL: URL_DB,
      SESSION_SECRET: 'sperre-test-geheimnis-lang-genug-1234',
      PORT: String(port),
      NODE_ENV: 'production',
      TRUST_PROXY: 'false',
      DB_SUPERUSER_ALLOWED: '1',
      APP_BASE_URL_MISSING_OK: '1',
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
  const anmelden = async (password, ip) => {
    try {
      return (
        await fetch(`http://127.0.0.1:${port}/api/v2/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
          body: JSON.stringify({ username: NAME, password }),
        })
      ).status;
    } catch {
      return 0;
    }
  };
  for (let i = 0; i < 240 && !/localhost:\d+|Startup complete/.test(log); i++) await warte(250);
  for (let i = 0; i < 40 && (await fetch(`http://127.0.0.1:${port}/api/v2/`).catch(() => null)) === null; i++)
    await warte(250);
  assert.equal(
    (await fetch(`http://127.0.0.1:${port}/api/v2/`)).headers.get('x-powered-by'),
    null,
    'Der Server verrät X-Powered-By',
  );

  // Changing X-Forwarded-For, but the same sender: without trust everything
  // counts on 127.0.0.1, the lock kicks in after MAX_ATTEMPTS.
  for (let i = 0; i < MAX_ATTEMPTS; i++)
    assert.equal(await anmelden('falsch', `198.51.100.${i + 1}`), 401, log.slice(-1500));
  assert.equal(await anmelden(PASS, '198.51.100.99'), 429, 'TRUST_PROXY=false wird nicht beachtet');
});
