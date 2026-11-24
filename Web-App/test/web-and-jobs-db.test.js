/**
 * A web and a job process from the same file (ROLE=web, ROLE=jobs),
 * the way compose.yaml starts them — on the real server.
 *
 * Counter-checks (measured 30.10.2026):
 *   A  in server.ts `const jobs = k.rolle !== 'web'` replaced by `true` →
 *      red: “the web process processes no jobs”
 *   B  in currentStartState (src/jobQueue/startState.ts) the re-read from
 *      run_state removed → red: “the web process sees the startup state of the
 *      job process”
 *   C  in server.ts app.use(onlyOwnOrigin) removed → red: “rejects
 *      writing requests from foreign sites” (200)
 *   D  in server.ts the call stopJobs() removed from shutdown() →
 *      red: “SIGTERM: the job process returns its running job”
 *   E  (31.10.2026) API_MIN_APP back to 1 → red: “an app with numbers instead of
 *      booleans (version 1) gets …” (401 instead of 426)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATABASE_URL = URL_DB;

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const { sleep } = require('./helpers/time');

function freePort() {
  return new Promise((opened, ab) => {
    const s = net
      .createServer()
      .listen(0, '127.0.0.1', () => {
        const { port } = /** @type {import('node:net').AddressInfo} */ (s.address());
        s.close(() => opened(port));
      })
      .on('error', ab);
  });
}

/** @param {number} port @param {string} route @param {{ method?: string, token?: string, head?: Record<string, string>, body?: unknown }} [o] */
function hole(port, route, { method = 'GET', token, head = {}, body } = {}) {
  return new Promise((opened, ab) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      {
        host: '127.0.0.1',
        port,
        path: route,
        method: method,
        agent: false,
        headers: {
          ...head,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
        },
      },
      res => {
        let raw = '';
        res.on('data', d => {
          raw += d;
        });
        res.on('end', () => {
          let j = null;
          try {
            j = JSON.parse(raw);
          } catch {}
          opened({ status: res.statusCode, headers: res.headers, body: j });
        });
      },
    );
    r.on('error', ab);
    if (data) r.write(data);
    r.end();
  });
}

function start(role, port) {
  const p = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DATABASE_URL: URL_DB,
      SESSION_SECRET: 'rollen-test-geheimnis-lang-genug-1234',
      PORT: String(port),
      ROLE: role,
      NODE_ENV: 'production',
      JOB_DEADLINE_SEC: '600',
      DB_SUPERUSER_ALLOWED: '1',
      APP_BASE_URL_MISSING_OK: '1',
    },
  });
  const withLog = /** @type {typeof p & { log: string }} */ (p);
  withLog.log = '';
  p.stdout.on('data', d => {
    withLog.log += d;
  });
  p.stderr.on('data', d => {
    withLog.log += d;
  });
  return withLog;
}

async function finish(p) {
  if (p.exitCode === null && p.signalCode === null) p.kill('SIGTERM');
  for (let i = 0; i < 150 && p.exitCode === null && p.signalCode === null; i++) await sleep(100);
  if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL');
}

test('web and job process', { concurrency: 1, timeout: 180_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  // Without today's stamps the job process downloads the Rebrickable catalog.
  for (const k of ['rb_csv_last_sync', 'rb_part_categories_last_sync', 'rb_catalog_extras_last_sync'])
    await db.run(
      `INSERT INTO run_state (key, value) VALUES ($1, to_char(NOW(), 'YYYY-MM-DD'))
                  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [k],
    );
  await db.run(`DELETE FROM run_state WHERE key = 'startup_status'`);

  const NAME = `rollen_${process.pid}`,
    PASS = 'Passwort12345',
    MARK = `rollen-${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  await db.run(`DELETE FROM jobs WHERE payload->>'mark' = $1`, [MARK]);
  await db.get(
    `INSERT INTO users (username, password_hash, is_active, email_verified) VALUES ($1, $2, true, true) RETURNING id`,
    [NAME, await bcrypt.hash(PASS, 4)],
  );

  const port = await freePort(),
    jobsPort = await freePort();
  const web = start('web', port);
  let jobs = null;
  /** The job the web process left lying; the job process should do it. */
  let firstOne = 0;
  const job = id => db.get('SELECT status, attempts FROM jobs WHERE id = $1', [id]);

  try {
    for (let i = 0; i < 240 && !/localhost:\d+/.test(web.log); i++) await sleep(250);
    assert.match(web.log, /Rolle web/, web.log.slice(-1500));

    await t.test('the web process processes no jobs', async () => {
      const id = (
        await db.get(`INSERT INTO jobs (type, payload) VALUES ('images', $1) RETURNING id`, [
          JSON.stringify({ set_number: `rollen-nichtda-${process.pid}`, mark: MARK }),
        ])
      ).id;
      await db.run(`SELECT pg_notify('jobs', 'images')`);
      await sleep(1500);
      assert.equal((await job(id)).status, 'pending', 'The web process claimed a job');
      firstOne = id;
    });

    await t.test('the web process sees the startup state of the job process', async () => {
      const prior = await hole(port, '/api/v2/startup-status');
      assert.equal(prior.body.ready, false, 'precondition: without a job process the catalogue is not checked');
      jobs = start('jobs', jobsPort);
      let r;
      for (let i = 0; i < 120; i++) {
        r = await hole(port, '/api/v2/startup-status');
        if (r.body?.ready) break;
        await sleep(250);
      }
      assert.equal(r.body.ready, true, `${JSON.stringify(r.body)}\n${jobs.log.slice(-1500)}`);
    });

    await t.test('the job process completes the job and accepts no requests', async () => {
      let z;
      for (let i = 0; i < 80; i++) {
        z = await job(firstOne);
        if (z.status !== 'pending' && z.status !== 'running') break;
        await sleep(250);
      }
      assert.equal(z.status, 'done', jobs.log.slice(-1500));
      assert.match(jobs.log, /Rolle jobs/);
      await assert.rejects(hole(jobsPort, '/api/v2/health'), /ECONNREFUSED/, 'The job process listens on a port');
    });

    await t.test('every API response names the interface version', async () => {
      const r = await hole(port, '/api/v2/health');
      const { API_VERSION, API_MIN_APP } = _req('src/http/apiVersion.js');
      assert.equal(r.headers['x-api-version'], String(API_VERSION));
      assert.equal(r.headers['x-api-min-app'], String(API_MIN_APP));
      assert.equal(r.body.db_pool, undefined, 'pool numbers without login');
      assert.equal(r.body.status, 'ok');
    });

    await t.test('a too old app is rejected with 426', async () => {
      const { API_MIN_APP } = _req('src/http/apiVersion.js');
      assert.equal(
        (await hole(port, '/api/v2/health', { head: { 'X-App-Api': String(API_MIN_APP - 1) } })).status,
        426,
      );
      assert.equal((await hole(port, '/api/v2/health', { head: { 'X-App-Api': String(API_MIN_APP) } })).status, 200);
    });

    await t.test('an app with numbers instead of booleans (version 1) gets “app too old”', async () => {
      // How the app recognizes the hint: status code, header, code (ServerWaechter.kt).
      const r = await hole(port, '/api/v2/auth/profile', { head: { 'X-App-Api': '1' } });
      assert.deepEqual([r.status, r.headers['x-api-min-app'], r.body.code], [426, '2', 'app_too_old']);
    });

    await t.test('rejects writing requests from foreign sites', async () => {
      const r = await hole(port, '/api/v2/auth/logout', { method: 'POST', head: { 'sec-fetch-site': 'cross-site' } });
      assert.equal(r.status, 403, 'src/http/origin.ts is not hooked into server.ts');
    });

    await t.test('SIGTERM: the job process returns its running job', async () => {
      // A job with a long deadline that the job process claims but never finishes:
      // It does not know the kind, so the test simulates the claim itself with its ID.
      const id = (
        await db.get(`INSERT INTO jobs (type, payload) VALUES ('images', $1) RETURNING id`, [
          JSON.stringify({ set_number: `rollen-zwei-${process.pid}`, mark: MARK }),
        ])
      ).id;
      jobs.kill('SIGTERM');
      web.kill('SIGTERM');
      for (let i = 0; i < 150 && (jobs.exitCode === null || web.exitCode === null); i++) await sleep(100);
      assert.equal(jobs.exitCode, 0, jobs.log.slice(-1500));
      assert.equal(web.exitCode, 0, web.log.slice(-1500));
      for (const p of [jobs, web]) assert.match(p.log, /\[shutdown\] Datenbankverbindungen geschlossen/);
      assert.match(jobs.log, /\[auftraege\] beendet/, 'The job process did not stop its worker');
      const z = await job(id);
      assert.notEqual(z.status, 'running', 'A job stayed claimed');
    });
  } finally {
    await finish(web);
    if (jobs) await finish(jobs);
    await db.run(`DELETE FROM jobs WHERE payload->>'mark' = $1`, [MARK]).catch(() => {});
    await db.run('DELETE FROM users WHERE username = $1', [NAME]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
