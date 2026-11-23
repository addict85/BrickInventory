/**
 * A job process that ends hard does not return its running jobs.
 * The next start takes them over immediately, not only after the deadline; jobs
 * of a living process and its own stay where they are.
 *
 * Counter-checks (06.11.2026):
 *   A  in giveOrphanedBack() the query pg_try_advisory_lock replaced by `true`
 *      → red: “a living process keeps its job”
 *   B  the UPDATE deleted in giveOrphanedBack() → red: “the start
 *      takes over the job of a dead process”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();

test('jobs of dead job processes', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const proc = _req('src/jobQueue/process.js');
  const { LOCKS } = _req('src/infra/lockNamespaces.js');
  const alive = await db.pool.connect();
  t.after(async () => {
    proc.deregisterProcess();
    alive.release(true);
    await db.pool.end().catch(() => {});
  });
  await alive.query('SELECT pg_advisory_lock($1, hashtext($2))', [LOCKS.JOB_PROCESS, 'lebender-prozess']);

  const running = async occupiedOf =>
    (
      await db.get(
        `INSERT INTO jobs (type, payload, status, locked_by, deadline_at, started_at, attempts)
     VALUES ('cleanup', '{}', 'running', $1, NOW() + interval '5 minutes', NOW(), 1) RETURNING id`,
        [occupiedOf],
      )
    ).id;
  const tot = await running('toter-prozess/1');
  const otherOne = await running('lebender-prozess/2');
  const ownOne = await running(`${proc.PROCESS}/3`);
  const status = async id => (await db.get('SELECT status FROM jobs WHERE id = $1', [id])).status;

  // What startup/jobsProcess.ts calls before the worker; starting the whole job operation
  // would launch real jobs that hold connections.
  await proc.registerProcess();

  await t.test('the start takes over the job of a dead process', async () => {
    assert.notEqual(await status(tot), 'running');
  });
  await t.test('a living process keeps its job', async () => {
    assert.equal(await status(otherOne), 'running');
  });
  await t.test('the own claims stay', async () => {
    assert.equal(await status(ownOne), 'running');
  });
});
