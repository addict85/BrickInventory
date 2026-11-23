/**
 * Health check on the real server: anonymously only the status goes out,
 * `live` answers without a database, `ready` asks it and reports 503 when it is
 * missing. The startup state goes out anonymously only with its known fields.
 *
 * Counter-checks (measured 01.11.2026):
 *   A  in /api/v2/health `startup` again for everyone → red: “anonymously only the status"
 *   B  /api/v2/health/ready without databaseResponds() (always 200) → red: “without a database
 *      ready reports 503"
 *   C  startup-status without publicStartState() → red: “the
 *      startup state only names its fields" (pfad and fehler went out)
 *   D  progress in the contract back to z.number().int() → red: the same check
 *      (contract_violated; the server reports steps with a fraction, e.g. 2.37)
 *   E  (03.11.2026) startup-status again with step for everyone (logged in
 *      always true) → red: “anonymously only the progress"
 *
 * Prerequisite: test DB via TEST_DATABASE_URL whose user is the owner.
 *
 * @superuser (ratchet in test/roles-separation-db.test.js)
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
const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
const { sleep } = require('./helpers/time');
const { portOf } = require('./helpers/server');
const freePort = () =>
  new Promise(r => {
    const s = net.createServer().listen(0, () => {
      const p = portOf(s);
      s.close(() => r(p));
    });
  });

test('health check and startup state', { concurrency: 1, timeout: 180_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const NAME = `gesund_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, 'x', true, true, true) RETURNING id`,
      [NAME],
    )
  ).id;
  const token = await _req('src/account/deviceToken.js').createToken(uid, 'Gesundheit', false, null, { scope: 'voll' });
  const { setState, deleteState } = require('./helpers/sources').testArea('jobQueue').runState;
  await setState(
    'startup_status',
    JSON.stringify({
      ready: false,
      step: 'Teile laden...',
      progress: 2.37,
      total: 8,
      sub: '40%',
      path: '/app/data/geheim.csv',
      error: 'Error: ECONNREFUSED at /app/dist/jobs/x.js:12',
    }),
  );
  t.after(async () => {
    await deleteState('startup_status');
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
      SESSION_SECRET: 'gesundheit-test-geheimnis-lang-genug-1234',
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
  const hole = (path, head = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, { headers: head }).then(async r => ({
      status: r.status,
      body: await r.json(),
    }));
  for (let i = 0; i < 240 && (await hole('/api/v2/health/live').catch(() => null)) === null; i++) await sleep(250);

  await t.test('anonymously only the status, the admin sees more', async () => {
    const anonym = await hole('/api/v2/health');
    assert.deepEqual(anonym, { status: 200, body: { status: 'starting' } }, log.slice(-1500));
    const adminUser = await hole('/api/v2/health', { authorization: `Bearer ${token}` });
    assert.deepEqual(Object.keys(adminUser.body).sort(), ['db_pool', 'startup', 'status', 'uptime_seconds']);
  });

  await t.test('the startup state only names its fields', async () => {
    const r = await hole('/api/v2/startup-status', { authorization: `Bearer ${token}` });
    assert.deepEqual(r.body, { ready: false, step: 'Teile laden...', progress: 2.37, total: 8, sub: '40%' });
  });

  await t.test('anonymously only the progress, not the step', async () => {
    const r = await hole('/api/v2/startup-status');
    assert.deepEqual(
      r.body,
      { ready: false, step: null, progress: 2.37, total: 8, sub: null },
      'anonymously only the progress',
    );
  });

  await t.test('live and ready answer with the database', async () => {
    assert.deepEqual(await hole('/api/v2/health/live'), { status: 200, body: { status: 'ok' } });
    assert.deepEqual(await hole('/api/v2/health/ready'), { status: 200, body: { status: 'ok' } });
  });

  await t.test('without a database ready reports 503, live still 200', async () => {
    const name = new URL(URL_DB).pathname.slice(1);
    const maintenance = new URL(URL_DB);
    maintenance.pathname = '/postgres';
    const admin = new Client({ connectionString: maintenance.toString() });
    await admin.connect();
    try {
      await admin.query(`ALTER DATABASE "${name}" ALLOW_CONNECTIONS false`);
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [name],
      );
      assert.deepEqual(await hole('/api/v2/health/ready'), {
        status: 503,
        body: {
          success: false,
          code: 'database_unreachable',
          status: 'unavailable',
          error: 'Datenbank nicht erreichbar',
        },
      });
      assert.deepEqual(await hole('/api/v2/health/live'), { status: 200, body: { status: 'ok' } });
    } finally {
      await admin.query(`ALTER DATABASE "${name}" ALLOW_CONNECTIONS true`);
      await admin.end();
    }
    let r;
    for (let i = 0; i < 40; i++) {
      r = await hole('/api/v2/health/ready');
      if (r.status === 200) break;
      await sleep(250);
    }
    assert.equal(r.status, 200, 'ready does not recover');
  });
});
