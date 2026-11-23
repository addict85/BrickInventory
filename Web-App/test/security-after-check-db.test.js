/**
 * Findings of the second security review on the real server (dist/server.js).
 *
 * Counter-checks (measured 01.11.2026):
 *   N1  `Cache-Control: no-store` deleted in the /api preamble of server.ts →
 *       red: “API and login paths …” (/api/v2/vouchers without header); the
 *       static file stays green, it has its own.
 *   H4  in asUploadError() the mapping of entity.parse.failed deleted →
 *       red: “broken JSON …” (response names „Expected double-quoted property name … at position 18")
 *   H2  router.param() switched off in contractRouter() → red: “too large IDs …”
 *       (path cases 400 value_invalid from the second line); the check of
 *       body and query in server.ts switched off → red (body cases); both
 *       and the mapping of 22003 gone → 500. Only 22003 gone → „PostgreSQL
 *       22003 …" red.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

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

test('verification on the real server', { concurrency: 1, timeout: 180_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const NAME = `nach_${process.pid}`,
    PASS = 'Nach-Pruefung-7x';
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`,
      [NAME, `${NAME}@example.org`, bcrypt.hashSync(PASS, 4)],
    )
  ).id;
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
      SESSION_SECRET: 'nachpruefung-test-geheimnis-lang-genug-1234',
      PORT: String(port),
      TRUST_PROXY: 'false',
      ROLE: 'web',
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

  const login = await fetch(`${basis}/api/v2/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: NAME, password: PASS, without_token: true }),
  });
  assert.equal(login.status, 200, `${await login.clone().text()}\n${log}`);
  const keks = login.headers.get('set-cookie').split(';')[0];
  const fetchIt = (path, o = {}) =>
    fetch(basis + path, { redirect: 'manual', ...o, headers: { cookie: keks, origin: basis, ...(o.headers || {}) } });

  await t.test('API and login paths carry no-store, static files do not', async () => {
    const fresh = await fetchIt('/api/v2/vouchers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ number: '6006491234567890', pin: '1234', amount: 25, currency: 'CHF' }),
    });
    assert.equal(fresh.status, 200, await fresh.clone().text());
    const list = await fetchIt('/api/v2/vouchers');
    assert.equal(list.status, 200);
    assert.equal((await list.json()).vouchers[0].pin, '•••');
    assert.equal(list.headers.get('cache-control'), 'no-store', '/api/v2/vouchers');
    assert.equal(login.headers.get('cache-control'), 'no-store', 'POST /api/v2/auth/login');
    for (const path of ['/api/v2/stats', '/reset-password?token=x', '/verify?token=x']) {
      const r = await fetchIt(path);
      await r.arrayBuffer();
      assert.equal(r.headers.get('cache-control'), 'no-store', path);
    }
    const staticPart = await fetchIt('/js/app.bundle.js');
    await staticPart.arrayBuffer();
    assert.equal(staticPart.status, 200);
    assert.doesNotMatch(staticPart.headers.get('cache-control'), /no-store/);
  });

  await t.test('broken JSON and too large requests: uniform response without parser text', async () => {
    for (const [path, withCookie] of /** @type {[string, boolean][]} */ ([
      ['/api/v2/auth/login', false],
      ['/api/v2/vouchers', true],
    ])) {
      const r = await (withCookie ? fetchIt : (p, o) => fetch(basis + p, o))(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"username": "x", ',
      });
      const text = await r.text();
      assert.equal(r.status, 400, path);
      // request_id leads from a screenshot to the log lines; it differs per request.
      const { request_id: _rid, ...body } = JSON.parse(text);
      assert.deepEqual(
        body,
        { success: false, code: 'request_json_invalid', error: 'Die Anfrage ist kein gültiges JSON' },
        path,
      );
      assert.doesNotMatch(text, /position|Unexpected|Expected|SyntaxError|body-parser/i, path);
    }
    const gross = await fetch(`${basis}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'x'.repeat(300 * 1024) }),
    });
    assert.deepEqual([gross.status, (await gross.json()).code], [413, 'request_too_large']);
  });

  await t.test('too large IDs in path and body yield 400, not 500', async () => {
    const GROSS = '99999999999999999999';
    const cases = [
      ['GET', `/api/v2/vouchers/${GROSS}/pdf`],
      ['PUT', `/api/v2/storage/locations/${GROSS}`, { name: 'Estrich' }],
      ['DELETE', '/api/v2/trash/2147483648'],
      ['PUT', `/api/v2/sets/10294-1/acquisitions/${GROSS}`, { quantity: 1 }],
      ['PUT', `/api/v2/auth/users/${GROSS}/active`, { is_active: true }],
      ['POST', '/api/v2/settings/household/unlink', { sub_user_id: 99999999999 }],
      ['POST', '/api/v2/settings/household/former/dismiss', { sub_user_id: GROSS }],
    ];
    const outcome = [];
    for (const [method, path, reqBody] of cases) {
      const r = await fetchIt(path, {
        method: method,
        headers: { 'content-type': 'application/json' },
        ...(reqBody ? { body: JSON.stringify(reqBody) } : {}),
      });
      outcome.push(`${method} ${path} ${r.status} ${(await r.json().catch(() => ({}))).code}`);
    }
    assert.deepEqual(
      outcome,
      cases.map(([m, p]) => `${m} ${p} 400 id_invalid`),
    );
    const limit = await fetchIt('/api/v2/storage/locations/2147483647', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Estrich' }),
    });
    assert.notEqual((await limit.json()).code, 'id_invalid', '2³¹−1 is still a valid ID');
  });
});

test('PostgreSQL 22003 (value outside the column type) becomes 400, not 500', () => {
  const script = `const { handleRouteError } = require(${JSON.stringify(path.join(ROOT, 'dist/src/http/httpResponse.js'))});
    console.warn = () => {};
    const res = { headersSent: false, status(s) { this.s = s; return this; }, json(b) { process.stdout.write(JSON.stringify([this.s, b.code])); } };
    handleRouteError(res, Object.assign(new Error('value "99999999999" is out of range for type integer'), { code: '22003' }), undefined, { method: 'GET', originalUrl: '/x' });`;
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, ['-e', script]).toString()), [400, 'value_invalid']);
});
