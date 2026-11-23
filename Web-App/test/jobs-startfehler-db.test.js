/**
 * A job process whose start fails ends with exit code 1 and
 * leaves no heartbeat: the health check must not consider a process without a
 * worker healthy.
 *
 * Checked on the real server (ROLE=jobs). A preloaded module makes
 * planAll() throw, as a missing table or connection would.
 *
 * Counter-checks (measured 05.11.2026):
 *   A  in server.ts again `void starte();` → red: “the process ends with
 *      exit code 1” (it kept running until the test aborted it after 20 s)
 *   B  in startJobs() the heartbeat again before planAll() → red:
 *      “no heartbeat without a worker”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATABASE_URL = URL_DB;
const ROOT = path.join(__dirname, '..');
const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

const PRELOAD = `
const Module = require('node:module');
const echt = Module.prototype.require;
Module.prototype.require = function (name) {
  const m = echt.apply(this, arguments);
  if (typeof name === 'string' && /(?:jobQueue[/\\\\]|^\\.\\/)schedule(\\.js)?$/.test(name))
    return { ...m, planAll: async () => { throw new Error('Testfehler: planAll'); } };
  return m;
};`;

test('a failed start of the job process ends it', { concurrency: 1, timeout: 90_000 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const { readState, deleteState } = require('./helpers/sources').testArea('jobQueue').runState;
  const { HEARTBEAT_KEY } = _req('startup/jobsProcess.js');
  await deleteState(HEARTBEAT_KEY);
  t.after(() => db.pool.end().catch(() => {}));

  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-startfehler-'));
  const preload = path.join(ordner, 'planAll-wirft.js');
  fs.writeFileSync(preload, PRELOAD);
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));

  const srv = spawn(process.execPath, ['--require', preload, path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: URL_DB, ROLE: 'jobs' },
  });
  let log = '';
  srv.stdout.on('data', d => {
    log += d;
  });
  srv.stderr.on('data', d => {
    log += d;
  });
  const ende = await new Promise(fertig => {
    const frist = setTimeout(() => {
      srv.kill('SIGKILL');
      fertig('lief weiter');
    }, 20_000);
    srv.on('exit', code => {
      clearTimeout(frist);
      fertig(code);
    });
  });

  await t.test('the process ends with exit code 1', () => {
    assert.equal(ende, 1, log.slice(-1500));
    assert.match(log, /Start gescheitert: .*Testfehler: planAll/);
  });

  await t.test('no sign of life without a worker', async () => {
    assert.equal(await readState(HEARTBEAT_KEY), null);
  });
});
