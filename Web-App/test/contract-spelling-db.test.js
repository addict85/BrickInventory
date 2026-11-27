/**
 * Every route from the API contract, spelled differently: all upper case,
 * with an upper-case initial after /api/v1 and with an appended “/”, “//”
 * or “%2F”. On the real server with Idempotency-Key. A different spelling is
 * a different route (404) and leaves nothing in `idempotency`.
 *
 * Counter-checks (measured on 04.11.2026, one change each, reverted afterwards):
 *   A  server.ts without `case sensitive routing` and contractRouter() without
 *      caseSensitive → red: “upper case is a different route” (routes
 *      answer, entries in idempotency) and “… not stored” (an
 *      UPPER-case token-rotieren has already replaced the token)
 *   B  only in the idempotency middleware `if (!route) return next();`
 *      deleted → red: “upper case …” (the 404 is stored under the key)
 *   C  routeForRequest() without cutting the slash → red only
 *      “routeForRequest maps …”
 *   D  (15.11.2026) in startup/app.ts the refusal for a trailing `/` deleted → red:
 *      “a trailing slash is a different route” (among others storage/locations/
 *      200, vouchers/1/klartext/ 403 from the second line instead of 404)
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
const { CONTRACT, routeForRequest } = _req('src/contract/index.js');
const { responseIsSecret: answerIsSecret } = _req('src/idempotency/http/middleware.js');
const { sleep } = require('./helpers/time');
const { portOf } = require('./helpers/server');
const freePort = () =>
  new Promise(r => {
    const s = net.createServer().listen(0, () => {
      const p = portOf(s);
      s.close(() => r(p));
    });
  });

const WRITING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ROUTES = Object.keys(CONTRACT).map(k => {
  const [m, p] = k.split(' ');
  return { m, p, url: p.replace(/:[A-Za-z_]+\??/g, '1') };
});

test('contract routes in a different spelling', { concurrency: 1, timeout: 300_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const name = `schreibung_${process.pid}`;
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
                             VALUES ($1, 'x', true, true) RETURNING id`,
      [name],
    )
  ).id;
  const token = await _req('src/account/deviceToken.js').createToken(uid, 'Schreibung');
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });

  const port = await freePort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DATABASE_URL: URL_DB,
      SESSION_SECRET: 'schreibung-test-geheimnis-lang-genug-1234',
      PORT: String(port),
      TRUST_PROXY: 'false',
      NODE_ENV: 'test',
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
  for (let i = 0; i < 240 && (await fetch(`http://127.0.0.1:${port}/api/v2/health`).catch(() => null)) === null; i++)
    await sleep(250);

  let n = 0;
  const callIt = async (m, url, key = `schreibung-${++n}`) => {
    const r = await fetch(`http://127.0.0.1:${port}${url}`, {
      method: m,
      redirect: 'manual',
      body: m === 'GET' ? undefined : '{}',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': key },
    });
    const text = await r.text();
    return { status: r.status, replay: r.headers.get('idempotent-replay'), text, key };
  };
  const saved = async key =>
    db.all(
      'SELECT key, status, response IS NOT NULL AS mit_antwort FROM idempotency WHERE user_id = $1 AND key = ANY($2)',
      [uid, key],
    );

  assert.ok(ROUTES.length > 150, `only ${ROUTES.length} contract routes — does the search still match?`);
  assert.ok((await callIt('GET', '/api/v2/settings')).status === 200, `the token is not valid: ${log.slice(-400)}`);

  await t.test('upper case is a different route', async () => {
    const wrong = [],
      key = [];
    for (const { m, url } of ROUTES) {
      const rest = url.slice('/api/v2/'.length);
      for (const anders of [url.toUpperCase(), rest && `/api/v2/${rest[0].toUpperCase()}${rest.slice(1)}`]) {
        if (!anders || anders === url) continue;
        const r = await callIt(m, anders);
        key.push(r.key);
        if (r.status !== 404 || r.replay) wrong.push(`${m} ${anders} → ${r.status}`);
      }
    }
    assert.deepEqual(wrong, []);
    assert.deepEqual(await saved(key), [], 'a differently spelled route wrote to idempotency');
  });

  await t.test('routeForRequest assigns a trailing slash to the same route', () => {
    // Throttle, step-up protection and idempotency ask like this; the refusal at the entrance is the first line.
    const anders = ROUTES.filter(
      ({ m, url }) =>
        routeForRequest(m, url + '/') !== routeForRequest(m, url) ||
        answerIsSecret(m, url + '/') !== answerIsSecret(m, url),
    );
    assert.deepEqual(
      anders.map(r => `${r.m} ${r.p}`),
      [],
    );
  });

  await t.test('a trailing slash is a different route', async () => {
    const wrong = [],
      key = [];
    // `/api/v2/` stands like this in the contract; `//` at the end is the same path there.
    for (const { m, url } of ROUTES.filter(r => !r.url.endsWith('/')))
      for (const anders of [url + '/', url + '//']) {
        const r = await callIt(m, anders);
        key.push(r.key);
        if (r.status !== 404 || r.replay) wrong.push(`${m} ${anders} → ${r.status}`);
      }
    assert.deepEqual(wrong, []);
    assert.deepEqual(await saved(key), []);
  });

  await t.test('… and a %2F at the end gets no secret response', async () => {
    const secret = ROUTES.filter(({ m, url }) => WRITING.has(m) && answerIsSecret(m, url));
    assert.ok(secret.length > 15, `only ${secret.length} secret routes`);
    const succeeded = [];
    for (const { m, url } of secret) {
      const r = await callIt(m, url + '%2F');
      if (r.status < 400) succeeded.push(`${m} ${url}%2F → ${r.status}`);
    }
    assert.deepEqual(succeeded, []);
  });
});
