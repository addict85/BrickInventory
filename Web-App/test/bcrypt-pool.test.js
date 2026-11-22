/**
 * bcrypt computes in worker threads (src/account/bcryptPool.ts, security review
 * round 13, H1): the main thread stays responsive during the checks, an
 * idle worker does not keep the process alive, and without a worker file
 * the main thread computes as before.
 *
 * Counter-checks (measured 04.11.2026, each alone):
 *   A  newPool() always computes in the main thread (`hauptthread = true`) → red:
 *      “computes in the worker …”, “the main thread stays responsive” and “the
 *      login checks via the pool”
 *   B  in naechster() `w.unref()` deleted → red: “an idle worker …”
 *   C  passwordFits() calls bcrypt.compare in the main thread again → red: “the
 *      login checks via the pool”
 *   D  in naechster() the idle timer deleted → red: “an idle
 *      worker ends after the idle time” (1 instead of 0 workers)
 *   E  bcryptArbeiter() without the upper limit 4 → red: “64 cores without quota”;
 *      without `kontingent` → red: “64 cores, quota 1”
 *   F  quotaCores() reads only cgroup v1 → red: “cgroup v2: 1.5 cores”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const os = require('node:os');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { newPool } = _req('src/account/bcryptPool.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

/** Longest delay of the event loop (ms) while `work` runs. */
async function longestDelay(work) {
  const h = monitorEventLoopDelay({ resolution: 5 });
  h.enable();
  await work();
  h.disable();
  return h.max / 1e6;
}

test('computes in the worker and correctly', async t => {
  const pool = newPool(2);
  t.after(() => pool.finish());
  const hash = await pool.hash('Geheim-2026', 4);
  assert.equal(await pool.compare('Geheim-2026', hash), true);
  assert.equal(await pool.compare('falsch', hash), false);
  assert.equal(await pool.compare('egal', 'x'), false, 'a broken hash is not a match');
  assert.equal(bcrypt.compareSync('Geheim-2026', hash), true, 'the hash is an ordinary bcrypt hash');
  assert.deepEqual(pool.state(), { worker: 1, frei: 1, wartend: 0, hauptthread: false }, 'computes in the worker …');
});

test('the main thread stays responsive', async t => {
  const pool = newPool(2);
  t.after(() => pool.finish());
  const hash = bcrypt.hashSync('Geheim-2026', 12);
  await pool.compare('aufwaermen', hash);
  const vier = f => Promise.all([1, 2, 3, 4].map(() => f('Geheim-2026', hash)));
  const inMainThread = await longestDelay(() => vier(bcrypt.compare));
  const imPool = await longestDelay(() => vier(pool.compare));
  console.log(`  ℹ longest event loop delay: main thread ${inMainThread.toFixed(0)} ms, pool ${imPool.toFixed(0)} ms`);
  assert.ok(inMainThread >= 50, `Precondition: bcryptjs blocks the main thread (${inMainThread} ms)`);
  assert.ok(imPool < inMainThread / 2, `the main thread stays responsive: ${imPool} ms versus ${inMainThread} ms`);
});

test('without a worker file the main thread computes', async () => {
  const pool = newPool(2, path.join(os.tmpdir(), `bcrypt-arbeiter-${process.pid}-fehlt.js`));
  assert.equal(await pool.compare('a', bcrypt.hashSync('a', 4)), true);
  assert.equal(pool.state().hauptthread, true);
});

test('an idle worker does not keep the process alive', () => {
  const code = `const { newPool } = require(${JSON.stringify(path.join(S.DIST, 'src/account/bcryptPool.js'))});
    newPool(1).hash('x', 4).then((h) => console.log(h.length));`;
  const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 15_000 });
  assert.equal(r.signal, null, 'an idle worker …: the process did not end by itself');
  assert.equal(r.stdout.trim(), '60', r.stderr);
});

test('login checks old bcrypt hashes via the pool', async () => {
  const { bcryptPool } = _req('src/account/bcryptLimit.js');
  const { passwordFits } = _req('src/account/passwordHash.js');
  assert.equal(await passwordFits('Geheim-2026', bcrypt.hashSync('Geheim-2026', 4)), true);
  assert.ok(bcryptPool.state().worker >= 1 && !bcryptPool.state().hauptthread, JSON.stringify(bcryptPool.state()));
  await bcryptPool.finish();
});

test('an idle worker ends after the idle time', async t => {
  const pool = newPool(2, undefined, 200);
  t.after(() => pool.finish());
  await pool.hash('x', 4);
  assert.equal(pool.state().worker, 1, 'Precondition: a worker was computing');
  for (let i = 0; i < 100 && pool.state().worker > 0; i++) await new Promise(r => setTimeout(r, 50));
  assert.equal(pool.state().worker, 0, 'an idle worker ends after the idle time');
  assert.equal(await pool.compare('x', await pool.hash('x', 4)), true, 'afterwards a new one is created');
  assert.deepEqual(pool.state(), { worker: 1, frei: 1, wartend: 0, hauptthread: false });
});

test('the number of workers is capped', () => {
  const { bcryptWorkers: bcryptWorker, quotaCores } = _req('src/account/bcryptLimit.js');
  const { loadConfig } = _req('src/infra/config.js');
  assert.equal(bcryptWorker(null, 64, null), 4, '64 cores without a quota');
  assert.equal(bcryptWorker(null, 64, 1), 2, '64 cores, quota 1');
  assert.equal(bcryptWorker(null, 3, null), 3);
  assert.equal(bcryptWorker(loadConfig({ BCRYPT_WORKERS: '8' }).bcryptWorker, 64, 2), 8, 'the variable applies');
  assert.equal(loadConfig({}).bcryptWorker, null);
  assert.throws(() => loadConfig({ BCRYPT_WORKERS: '0' }), /BCRYPT_WORKERS="0"/, 'an invalid value stops the startup');

  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'cgroup-'));
  const t = (f, inhalt) => {
    fs.mkdirSync(path.dirname(path.join(wurzel, f)), { recursive: true });
    fs.writeFileSync(path.join(wurzel, f), inhalt);
  };
  try {
    assert.equal(quotaCores(wurzel), null, 'no quota without files');
    t('cpu/cpu.cfs_quota_us', '50000\n');
    t('cpu/cpu.cfs_period_us', '100000\n');
    assert.equal(quotaCores(wurzel), 1, 'cgroup v1: halber Kern');
    t('cpu/cpu.cfs_quota_us', '-1\n');
    assert.equal(quotaCores(wurzel), null, 'cgroup v1 without a quota');
    t('cpu.max', '150000 100000\n');
    assert.equal(quotaCores(wurzel), 2, 'cgroup v2: 1,5 Kerne');
    t('cpu.max', 'max 100000\n');
    assert.equal(quotaCores(wurzel), null, 'cgroup v2 without a quota');
  } finally {
    fs.rmSync(wurzel, { recursive: true, force: true });
  }
});
