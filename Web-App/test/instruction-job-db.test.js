/**
 * The instruction fetch as job 'instructions' (src/catalog/loadInstruction.ts):
 * spacing only after a real fetch, the Cloudflare ladder as a pause of the
 * whole kind, the lock against a second job process, a set only open
 * once. The fetch itself is rebuilt; what is checked is what the handler
 * makes of it.
 *
 * Counter-checks (measured on 30.10.2026):
 *   A  `if (lastFetchWasExternal())` removed before the tick pause → red: “after
 *      a supplied set nobody waits”
 *   B  in the Cloudflare ladder `level + 1` replaced by `level` → red: “the
 *      Cloudflare ladder rises and ends the next day”
 *   C  in withLock() the check `!rows[0]?.ok` replaced by `false` → red:
 *      “if another process holds the lock, nothing is fetched”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const fetching = { outside: false, error_message: null, calls: 0 };
const realRequire = Module.prototype.require;
Module.prototype.require = function (name, ...rest) {
  const m = realRequire.call(this, name, ...rest);
  if (!/[/\\]instructions(\.js)?$/.test(name)) return m;
  return {
    ...m,
    instructionCount: async () => 0,
    lastFetchWasExternal: () => fetching.outside,
    loadSetInstructions: async () => {
      fetching.calls++;
      if (fetching.error_message) throw fetching.error_message;
      return 1;
    },
  };
};

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();

test('instructions as a job', { concurrency: 1 }, async t => {
  try {
    await db.initSchemaOnce();
  } catch (e) {
    noDb(t, e);
    return;
  }
  const Q = _req('src/catalog/loadInstruction.js');
  const A = Object.assign({}, _req('src/jobQueue/jobs.js'), {
    ..._req('src/jobQueue/service.js'),
    ...require('./helpers/sources').testArea('jobQueue').jobs,
  });
  const { JobMove } = _req('jobs/jobWorker.js');
  const pause = () => A.readPause('instructions');
  const inSec = async () => {
    const p = await pause();
    return p ? Math.round((new Date(p.until_at).getTime() - Date.now()) / 1000) : null;
  };
  const reset = () => db.run(`DELETE FROM job_pauses WHERE type = 'instructions'`);
  t.after(async () => {
    Module.prototype.require = realRequire;
    await reset();
    await db.run(`DELETE FROM jobs WHERE type = 'instructions'`);
    await db.pool.end().catch(() => {});
  });

  await t.test('after a supplied set nobody waits', async () => {
    await reset();
    fetching.outside = false;
    fetching.error_message = null;
    await Q.loadInstruction({ set_number: '10001-1' });
    assert.equal(await pause(), null, 'no pause without a foreign fetch');
    fetching.outside = true;
    await Q.loadInstruction({ set_number: '10002-1' });
    const s = await inSec();
    assert.ok(s >= 13 && s <= 15, `after a real fetch ${s} s gap instead of 15`);
  });

  await t.test('the Cloudflare ladder climbs and ends the next day', async () => {
    await reset();
    fetching.error_message = new Error('Cloudflare error 1015: rate limited');
    const seen = [];
    for (let i = 0; i < 5; i++) {
      await assert.rejects(Q.loadInstruction({ set_number: '10003-1' }), e => e instanceof JobMove);
      seen.push(await inSec());
      await db.run(`UPDATE job_pauses SET until_at = NOW() WHERE type = 'instructions'`);
    }
    assert.deepEqual(
      seen.slice(0, 4).map(s => Math.round(s / 60)),
      [5, 10, 15, 20],
    );
    const morgen = Q.nextTag(new Date());
    assert.ok(Math.abs(seen[4] - (morgen - Date.now()) / 1000) < 5, 'after the fourth lock until_at tomorrow');
    fetching.error_message = null;
    fetching.outside = false;
    await Q.loadInstruction({ set_number: '10003-1' });
    assert.equal(await pause(), null, 'a success resets the ladder');
  });

  await t.test('if another process holds the lock, nothing is fetched', async () => {
    await reset();
    const { LOCKS } = _req('src/infra/lockNamespaces.js');
    const fremd = await db.pool.connect();
    await fremd.query('SELECT pg_advisory_lock($1, 0)', [LOCKS.INSTRUCTION_QUEUE]);
    const prior = fetching.calls;
    try {
      await assert.rejects(Q.loadInstruction({ set_number: '10004-1' }), e => e instanceof JobMove);
      assert.equal(fetching.calls, prior, 'fetched despite a foreign lock');
    } finally {
      await fremd.query('SELECT pg_advisory_unlock($1, 0)', [LOCKS.INSTRUCTION_QUEUE]);
      fremd.release();
    }
    await Q.loadInstruction({ set_number: '10004-1' });
    assert.equal(fetching.calls, prior + 1, 'Counter-check: without a foreign lock it is fetched');
  });

  await t.test('a set is open only once', async () => {
    await db.run(`DELETE FROM jobs WHERE type = 'instructions'`);
    const E = _req('src/catalog/instructionJob.js');
    await E.enqueueInstruction('10005');
    await E.enqueueInstruction('10005-1');
    const z = await require('./helpers/sources').testServices().jobQueue.countKind('instructions');
    assert.equal(z.pending + z.running, 1, 'the same set (with and without version) queued twice');
  });
});
