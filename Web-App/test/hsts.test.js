'use strict';
/**
 * HSTS on the real server (dist/server.js), and only over an encrypted
 * connection: in the LAN the same server runs over http, and a browser that
 * has seen the rule once would lock it out for a year afterwards.
 *
 * Counter-checks (measured 05.11.2026, each alone, dist rebuilt):
 *   A  in securityHeaders() `if (viaTls && …)` → `if (hstsAlter !== 0)` →
 *      red: “without TLS no header”, “a raw header …”
 *   B  `const viaTls = req.secure || req.headers['x-forwarded-proto'] ===
 *      'https'` → red: “a raw header without a trusted proxy sets nothing”
 *   C  `&& hstsAlter !== 0` deleted → red: “HSTS_MAX_AGE=0 switches off”
 *   D  the line with Strict-Transport-Security deleted → red: “over TLS
 *      one year with subdomains”
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
const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { until } = require('./helpers/time');
const freePort = () =>
  new Promise(r => {
    const s = net.createServer().listen(0, () => {
      const p = /** @type {import('node:net').AddressInfo} */ (s.address()).port;
      s.close(() => r(p));
    });
  });

/** A web process in production mode with its own environment; it ends in the test's teardown. */
async function startServer(t, env) {
  const port = await freePort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DATABASE_URL: URL_DB,
      SESSION_SECRET: 'hsts-test-geheimnis-lang-genug-12345678',
      PORT: String(port),
      ROLE: 'web',
      APP_BASE_URL: `http://127.0.0.1:${port}`,
      // As in production: only there does Express trust the proxy; the test DB runs as superuser.
      NODE_ENV: 'production',
      DB_SUPERUSER_ALLOWED: '1',
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
    await until(() => srv.exitCode !== null || srv.signalCode !== null, 4000);
    if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGKILL');
  });
  const basis = `http://127.0.0.1:${port}`;
  const ready = await until(
    async () => (await fetch(`${basis}/api/v2/health/live`).catch(() => null)) !== null,
    60_000,
  );
  assert.ok(ready, `the server does not start:\n${log.slice(-2000)}`);
  /** @param {Record<string, string>} [head] */
  return async (head = {}) => {
    const r = await fetch(`${basis}/api/v2/health/live`, { headers: head });
    await r.arrayBuffer();
    return r.headers;
  };
}

const TLS = { 'x-forwarded-proto': 'https' };

test('HSTS only over TLS', { concurrency: 1, timeout: 180_000 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  // One after another, each with its own environment.
  // Each answers once with and once without TLS; the cases check the responses.
  /** @type {Record<string, { tls: Headers, without: Headers }>} */
  const k = {};
  for (const [name, env] of Object.entries({
    behindProxy: { TRUST_PROXY: '' },
    withoutProxy: { TRUST_PROXY: 'false' },
    disabled: { TRUST_PROXY: '', HSTS_MAX_AGE: '0' },
  }))
    await t.test(`Server ${name}`, async st => {
      const hole = await startServer(st, env);
      k[name] = { tls: await hole(TLS), without: await hole() };
    });
  const behindProxy = async head => (head ? k.behindProxy.tls : k.behindProxy.without);
  const withoutProxy = async head => (head ? k.withoutProxy.tls : k.withoutProxy.without);
  const disabled = async head => (head ? k.disabled.tls : k.disabled.without);

  await t.test('over TLS one year with subdomains', async () => {
    assert.equal((await behindProxy(TLS)).get('strict-transport-security'), 'max-age=31536000; includeSubDomains');
  });

  await t.test('without TLS no header', async () => {
    assert.equal((await behindProxy()).get('strict-transport-security'), null);
  });

  await t.test('a raw header without a trusted proxy sets nothing', async () => {
    assert.equal((await withoutProxy(TLS)).get('strict-transport-security'), null);
  });

  await t.test('HSTS_MAX_AGE=0 switches it off', async () => {
    assert.equal((await disabled(TLS)).get('strict-transport-security'), null);
  });

  await t.test('the other security headers stay, even without HSTS', async () => {
    for (const head of [await behindProxy(TLS), await disabled(TLS)]) {
      assert.deepEqual(
        ['x-frame-options', 'x-content-type-options', 'referrer-policy'].map(n => head.get(n)),
        ['SAMEORIGIN', 'nosniff', 'same-origin'],
      );
      assert.match(head.get('content-security-policy') ?? '', /default-src 'self'/);
      assert.match(head.get('permissions-policy') ?? '', /camera=\(\)/);
    }
  });
});
