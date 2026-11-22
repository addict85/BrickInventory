/**
 * Idempotency-Key: the repetition of a writing request gets the
 * stored response and has no second effect. Checked on the real server
 * (login, middleware order, route) and on the service (running,
 * server error, cleanup).
 *
 * Counter-checks (measured 31.10.2026):
 *   A  app.use('/api/v2', idempotency) deleted in server.ts → red:
 *      “repetition does not act twice" (quantity 4 instead of 3), no replay header
 *   B  in begin() the fingerprint comparison removed → red:
 *      “different content under the same key" (200 instead of 422)
 *   C  end() also remembers 5xx → red: “a server error frees the key"
 *   D  cleanupIdempotency without deadline (delete everything) → red: the fresh entry is missing
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
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
const { warte } = require('./helpers/time');
const { portOf } = require('./helpers/server');
const freePort = () =>
  new Promise(r => {
    const s = net.createServer().listen(0, () => {
      const p = portOf(s);
      s.close(() => r(p));
    });
  });

test('Idempotency-Key', { concurrency: 1, timeout: 180_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const konto = async name => {
    await db.run('DELETE FROM users WHERE username = $1', [name]);
    const id = (
      await db.get(
        `INSERT INTO users (username, password_hash, is_active, email_verified)
                              VALUES ($1, 'x', true, true) RETURNING id`,
        [name],
      )
    ).id;
    await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, '3001id', 5, 'manual')`, [id]);
    await db.run(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity) VALUES ($1, '3001id', 5, 2)`,
      [id],
    );
    return { id, token: await _req('src/account/deviceToken.js').createToken(id, 'Idempotenz-Probe') };
  };
  const a = await konto(`idem_a_${process.pid}`),
    b = await konto(`idem_b_${process.pid}`);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[a.id, b.id]]);
    await db.pool.end().catch(() => {});
  });

  const port = await freePort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DATABASE_URL: URL_DB,
      SESSION_SECRET: 'idempotency-test-geheimnis-lang-genug-1234',
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
  for (let i = 0; i < 240 && (await fetch(`http://127.0.0.1:${port}/api/v2/health`).catch(() => null)) === null; i++)
    await warte(250);

  const put = async (wer, key, body) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/v2/parts/3001id/5`, {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${wer.token}`,
        'content-type': 'application/json',
        ...(key ? { 'idempotency-key': key } : {}),
      },
    });
    return { status: r.status, replay: r.headers.get('idempotent-replay'), body: await r.json() };
  };
  const quantity = async wer =>
    Number(
      (
        await db.get(
          "SELECT COALESCE(SUM(quantity),0)::int q FROM part_acquisitions WHERE user_id=$1 AND part_number='3001id'",
          [wer.id],
        )
      ).q,
    );

  await t.test('a repetition does not act twice and delivers the same response', async () => {
    const erst = await put(a, 'k-1', { quantity_delta: 1 });
    assert.deepEqual(erst, { status: 200, replay: null, body: { success: true, quantity: 3 } }, log.slice(-2000));
    const nochmal = await put(a, 'k-1', { quantity_delta: 1 });
    assert.deepEqual(nochmal, { status: 200, replay: 'true', body: { success: true, quantity: 3 } });
    assert.equal(await quantity(a), 3);
  });

  await t.test('the key applies per account', async () => {
    assert.deepEqual((await put(b, 'k-1', { quantity_delta: 1 })).body, { success: true, quantity: 3 });
    assert.equal(await quantity(b), 3);
  });

  await t.test('different content under the same key is rejected', async () => {
    const r = await put(a, 'k-1', { quantity_delta: 5 });
    assert.equal(r.status, 422);
    assert.equal(r.body.code, 'idempotency_key_mismatch');
    assert.equal(await quantity(a), 3);
  });

  await t.test('an invalid key is rejected, without a key every request acts', async () => {
    assert.equal((await put(a, 'mit leerzeichen', { quantity_delta: 1 })).status, 400);
    await put(a, null, { quantity_delta: 1 });
    await put(a, null, { quantity_delta: 1 });
    assert.equal(await quantity(a), 5);
  });

  const serviceFn = _req('src/idempotency/service.js');
  const abdruck = serviceFn.fingerprint('PUT', '/x', { y: 1 });

  await t.test('a running first request: the repetition waits', async () => {
    assert.deepEqual(await serviceFn.begin(a.id, 'k-lauf', abdruck), { kind: 'new' });
    assert.deepEqual(await serviceFn.begin(a.id, 'k-lauf', abdruck), { kind: 'running' });
  });

  await t.test('a server error releases the key, a 4xx is remembered', async () => {
    await serviceFn.end(a.id, 'k-lauf', 500, '{"success":false}');
    assert.deepEqual(await serviceFn.begin(a.id, 'k-lauf', abdruck), { kind: 'new' });
    await serviceFn.end(a.id, 'k-lauf', 404, '{"success":false}');
    assert.deepEqual(await serviceFn.begin(a.id, 'k-lauf', abdruck), {
      kind: 'replay',
      status: 404,
      response: '{"success":false}',
    });
  });

  await t.test('cleanup only takes what is older than the deadline', async () => {
    await db.run(
      `UPDATE idempotency SET created_at = NOW() - make_interval(hours => $2)
                   WHERE user_id = $1 AND key = 'k-1'`,
      [a.id, serviceFn.EXPIRY_HOURS + 1],
    );
    assert.ok((await serviceFn.cleanupIdempotency()) >= 1);
    const uebrig = (await db.all('SELECT key FROM idempotency WHERE user_id = $1 ORDER BY 1', [a.id])).map(r => r.key);
    assert.deepEqual(uebrig, ['k-lauf']);
  });
});
