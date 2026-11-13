'use strict';
/**
 * HSTS am echten Server (dist/server.js), und nur über eine verschlüsselte
 * Verbindung: Im LAN läuft derselbe Server über http, und ein Browser, der
 * die Regel einmal gesehen hat, sperrte ihn danach ein Jahr lang aus.
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln, dist neu gebaut):
 *   A  in sicherheitsKoepfe() `if (ueberTls && …)` → `if (hstsAlter !== 0)` →
 *      rot: „ohne TLS keine Kopfzeile“, „ein roher Kopf …“
 *   B  `const ueberTls = req.secure || req.headers['x-forwarded-proto'] ===
 *      'https'` → rot: „ein roher Kopf ohne vertrauten Proxy setzt nichts“
 *   C  `&& hstsAlter !== 0` gestrichen → rot: „HSTS_MAX_AGE=0 schaltet ab“
 *   D  die Zeile mit Strict-Transport-Security gestrichen → rot: „über TLS
 *      ein Jahr mit Subdomains“
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
const { bis } = require('./helpers/zeit');
const freierPort = () =>
  new Promise(r => {
    const s = net.createServer().listen(0, () => {
      const p = /** @type {import('node:net').AddressInfo} */ (s.address()).port;
      s.close(() => r(p));
    });
  });

/** Ein Webprozess im Betriebsmodus mit eigener Umgebung; er endet im Nachlauf des Tests. */
async function starteServer(t, env) {
  const port = await freierPort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DATABASE_URL: URL_DB,
      SESSION_SECRET: 'hsts-test-geheimnis-lang-genug-12345678',
      PORT: String(port),
      ROLLE: 'web',
      APP_BASE_URL: `http://127.0.0.1:${port}`,
      // Wie im Betrieb: Nur dort vertraut Express dem Proxy; die Test-DB läuft als Superuser.
      NODE_ENV: 'production',
      DB_SUPERUSER_ERLAUBT: '1',
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
    await bis(() => srv.exitCode !== null || srv.signalCode !== null, 4000);
    if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGKILL');
  });
  const basis = `http://127.0.0.1:${port}`;
  const bereit = await bis(async () => (await fetch(`${basis}/api/v1/health/live`).catch(() => null)) !== null, 60_000);
  assert.ok(bereit, `der Server startet nicht:\n${log.slice(-2000)}`);
  /** @param {Record<string, string>} [kopf] */
  return async (kopf = {}) => {
    const r = await fetch(`${basis}/api/v1/health/live`, { headers: kopf });
    await r.arrayBuffer();
    return r.headers;
  };
}

const TLS = { 'x-forwarded-proto': 'https' };

test('HSTS nur über TLS', { concurrency: 1, timeout: 180_000 }, async t => {
  const db = await dbOderSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  // Nacheinander: Auf einer Datenbank läuft nur ein Web-Prozess (startup/einzelinstanz.ts).
  // Jeder antwortet einmal mit und einmal ohne TLS; die Fälle prüfen die Antworten.
  /** @type {Record<string, { tls: Headers, ohne: Headers }>} */
  const k = {};
  for (const [name, env] of Object.entries({
    hinterProxy: { TRUST_PROXY: '' },
    ohneProxy: { TRUST_PROXY: 'false' },
    abgestellt: { TRUST_PROXY: '', HSTS_MAX_AGE: '0' },
  }))
    await t.test(`Server ${name}`, async st => {
      const hole = await starteServer(st, env);
      k[name] = { tls: await hole(TLS), ohne: await hole() };
    });
  const hinterProxy = async kopf => (kopf ? k.hinterProxy.tls : k.hinterProxy.ohne);
  const ohneProxy = async kopf => (kopf ? k.ohneProxy.tls : k.ohneProxy.ohne);
  const abgestellt = async kopf => (kopf ? k.abgestellt.tls : k.abgestellt.ohne);

  await t.test('über TLS ein Jahr mit Subdomains', async () => {
    assert.equal((await hinterProxy(TLS)).get('strict-transport-security'), 'max-age=31536000; includeSubDomains');
  });

  await t.test('ohne TLS keine Kopfzeile', async () => {
    assert.equal((await hinterProxy()).get('strict-transport-security'), null);
  });

  await t.test('ein roher Kopf ohne vertrauten Proxy setzt nichts', async () => {
    assert.equal((await ohneProxy(TLS)).get('strict-transport-security'), null);
  });

  await t.test('HSTS_MAX_AGE=0 schaltet ab', async () => {
    assert.equal((await abgestellt(TLS)).get('strict-transport-security'), null);
  });

  await t.test('die übrigen Sicherheitskopfzeilen bleiben, auch ohne HSTS', async () => {
    for (const kopf of [await hinterProxy(TLS), await abgestellt(TLS)]) {
      assert.deepEqual(
        ['x-frame-options', 'x-content-type-options', 'referrer-policy'].map(n => kopf.get(n)),
        ['SAMEORIGIN', 'nosniff', 'same-origin'],
      );
      assert.match(kopf.get('content-security-policy') ?? '', /default-src 'self'/);
      assert.match(kopf.get('permissions-policy') ?? '', /camera=\(\)/);
    }
  });
});
