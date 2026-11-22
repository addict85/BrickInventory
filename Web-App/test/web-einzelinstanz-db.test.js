/**
 * Exactly one web process runs per database (startup/singleInstance.ts): throttle,
 * PDF tickets and cache live in its memory. A second one waits
 * for the first to end and then gives up with a clear message; if the lock
 * connection drops, the process reclaims the lock or gives up.
 *
 * Counter-checks (measured 12.11.2026, each individually):
 *   A  in server.ts the call holdWebLock() deleted → red: “the real server
 *      waits as long as another one holds the lock”
 *   B  in attemptsProcessLock() pg_try_advisory_lock replaced by `SELECT true AS ok` → red:
 *      “a second access does not get the lock …”
 *   C  in the error listener of hold() reclaim nothing (only `client = null`) → red:
 *      “after a disconnect the process gets the lock back”
 *   D  give up on a connection error instead of retrying → red: “if the
 *      database is missing for a while, it gets the lock back afterwards”
 *   E  (13.11.2026) without `database =` in halter(), while ANOTHER database
 *      in the cluster holds the lock → red: “a second access …” (2 instead of 1); with
 *      the condition green under the same disturbance
 *
 * @superuser (ratchet in test/roles-separation-db.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { accessOrSkip } = require('./helpers/db');
const { bis } = require('./helpers/time');
const modul = require(path.join(__dirname, '..', 'dist', 'db', 'database.js'));

const ROOT = path.join(__dirname, '..');
const SHORT = { wartenMs: 300, taktMs: 50 };

test('one web process per database', { concurrency: 1 }, async t => {
  const db = await accessOrSkip(t, _req);
  if (!db) return;
  const { holdWebLock: realLock, SecondWebProcess } = _req('startup/singleInstance.js');
  // Every held lock is released at the end, even if a case fails before.
  const offen = new Set();
  const holdWebLock = async (zugang, o) => {
    const f = await realLock(zugang, o);
    offen.add(f);
    return async () => {
      offen.delete(f);
      await f();
    };
  };
  const { LOCKS } = _req('src/infra/lockNamespaces.js');
  const a = modul.createDb(modul.dbConfigFromEnvironment()),
    b = modul.createDb(modul.dbConfigFromEnvironment());
  t.after(async () => {
    for (const f of offen) await f();
    await a.pool.end();
    await b.pool.end();
    await db.pool.end().catch(() => {});
  });
  const halter = () =>
    // pg_locks applies to the whole cluster: parallel test files hold the same lock on their copy.
    db.all(
      `SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND classid = $1 AND objid = 0 AND granted
              AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
      [LOCKS.WEB_PROCESS],
    );
  const stumm = async f => {
    const echt = console.warn;
    console.warn = () => {};
    try {
      return await f();
    } finally {
      console.warn = echt;
    }
  };

  await t.test('a second access does not get the lock and says why', async () => {
    const frei = await holdWebLock(a, SHORT);
    try {
      await stumm(() => assert.rejects(holdWebLock(b, SHORT), SecondWebProcess));
      await stumm(() => assert.rejects(holdWebLock(b, SHORT), /zweiter Web-Prozess.*ROLLE=jobs/s));
      assert.equal((await halter()).length, 1);
    } finally {
      await frei();
    }
    assert.equal((await halter()).length, 0, 'freigegeben');
  });

  await t.test('it waits for an ending predecessor', async () => {
    const frei = await holdWebLock(a, SHORT);
    const zweiter = stumm(() => holdWebLock(b, { wartenMs: 5000, taktMs: 50 }));
    setTimeout(() => void frei(), 200);
    const frei2 = await zweiter;
    assert.equal((await halter()).length, 1);
    await frei2();
  });

  await t.test('after a disconnect the process gets the lock back', async () => {
    const losses = [];
    const frei = await holdWebLock(a, { ...SHORT, atLoss: e => losses.push(e) });
    const [{ pid }] = await halter();
    await db.get('SELECT pg_terminate_backend($1)', [pid]);
    assert.ok(await bis(async () => (await halter()).some(h => h.pid !== pid), 3000), 'Sperre zurückgeholt');
    assert.deepEqual(losses, []);
    await frei();
  });

  await t.test('… or gives up if another one holds it in the meantime', async () => {
    const losses = [];
    const frei = await holdWebLock(a, { ...SHORT, atLoss: e => losses.push(e) });
    const [{ pid }] = await halter();
    const fremd = await b.ownConnection();
    try {
      const wartet = fremd.query('SELECT pg_advisory_lock($1, 0)', [LOCKS.WEB_PROCESS]);
      await db.get('SELECT pg_terminate_backend($1)', [pid]);
      await wartet;
      await stumm(() => bis(() => losses.length > 0, 3000));
      assert.equal(losses.length, 1);
      assert.ok(losses[0] instanceof SecondWebProcess, String(losses[0]));
    } finally {
      await fremd.end();
      await frei();
    }
  });

  await t.test('if the database is missing for a while, it gets the lock back afterwards', async () => {
    const losses = [];
    const frei = await holdWebLock(a, { ...SHORT, atLoss: e => losses.push(e) });
    const [{ pid }] = await halter();
    const name = new URL(process.env.DATABASE_URL).pathname.slice(1);
    const maintenance = new URL(process.env.DATABASE_URL);
    maintenance.pathname = '/postgres';
    const { Client } = require('pg');
    const admin = new Client({ connectionString: maintenance.toString() });
    await admin.connect();
    try {
      await admin.query(`ALTER DATABASE "${name}" ALLOW_CONNECTIONS false`);
      await admin.query('SELECT pg_terminate_backend($1)', [pid]);
      // Longer than the wait period (300 ms): a connection error is not a second process.
      await bis(() => false, 800);
    } finally {
      await admin.query(`ALTER DATABASE "${name}" ALLOW_CONNECTIONS true`);
      await admin.end();
    }
    assert.ok(await bis(async () => (await halter().catch(() => [])).length === 1, 5000), 'Sperre zurückgeholt');
    assert.deepEqual(losses, []);
    await frei();
  });

  await t.test('the real server waits as long as another one holds the lock', async () => {
    const frei = await holdWebLock(a, SHORT);
    let released = false;
    t.after(() => (released ? undefined : frei()));
    const port = await new Promise(r => {
      const s = net.createServer().listen(0, () => {
        const p = /** @type {import('node:net').AddressInfo} */ (s.address()).port;
        s.close(() => r(p));
      });
    });
    const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SESSION_SECRET: 'einzelinstanz-test-geheimnis-lang-genug-1',
        PORT: String(port),
        ROLLE: 'web',
        NODE_ENV: 'production',
        DB_SUPERUSER_ERLAUBT: '1',
        APP_BASE_URL_FEHLT_OK: '1',
        COOKIE_SECURE: '0',
      },
    });
    let log = '';
    srv.stdout.on('data', d => {
      log += d;
    });
    srv.stderr.on('data', d => {
      log += d;
    });
    t.after(() => {
      if (srv.exitCode === null) srv.kill('SIGKILL');
    });
    const lebt = async () => (await fetch(`http://127.0.0.1:${port}/api/v1/health/live`).catch(() => null))?.ok;
    assert.ok(await bis(() => /anderer Web-Prozess hält die Sperre/.test(log), 30_000), log.slice(-1500));
    assert.equal(await lebt(), undefined, 'er nimmt keine Anfragen an, solange der andere lebt');
    released = true;
    await frei();
    assert.ok(await bis(lebt, 30_000), `nach dem Ende des anderen startet er:\n${log.slice(-1500)}`);
    srv.kill('SIGTERM');
  });
});
