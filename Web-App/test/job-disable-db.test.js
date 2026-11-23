/**
 * A worker that is occupying a job at the moment of shutdown returns it:
 * stoppe() waits for the running occupation, and whatever arrives after that
 * is no longer executed but released.
 *
 * The timing is forced: a lock on the table holds the
 * occupation (UPDATE … RETURNING) while stoppe() is called.
 *
 * Counter-check (measured 01.11.2026): in pumpe() the check `if (beendet)`
 * after the occupation and the wait for pumpLauf in stoppe() removed → red:
 * “the job does not stay occupied” (status 'laeuft', the handler started).
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, testAccess } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { sleep } = require('./helpers/time');

test('switching off during a claim', async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const A = { ..._req('src/jobQueue/service.js'), ...require('./helpers/sources').testArea('jobQueue').jobs };
  const { createWorker } = _req('jobs/jobWorker.js');
  const KIND = `abschalten-${process.pid}`;
  const MARK = `abschalten-${process.pid}`;
  // A test kind needs a schema for its payload like any other.
  require('./helpers/sources')
    .testServices()
    .jobQueue.registerKind({ kind: KIND, payload: require('zod').looseObject({}), run: async () => {} });
  await db.run('INSERT INTO job_types (type) VALUES ($1) ON CONFLICT DO NOTHING', [KIND]);
  const lock = await db.pool.connect();
  let letGo = () => {};
  const hangs = new Promise(r => {
    letGo = () => r(null);
  });
  t.after(async () => {
    letGo();
    await lock.query('ROLLBACK').catch(() => {});
    lock.release();
    await db.run(`DELETE FROM jobs WHERE payload->>'mark' = $1`, [MARK]).catch(() => {});
    await testAccess()
      .notification.close()
      .catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const id = await A.placeJobOne(KIND, { mark: MARK });
  let started = false;
  // Hangs until the end of the test: a started job would thus stay at 'laeuft'.
  const w = createWorker(
    require('./helpers/sources').testServices().jobQueue,
    {
      [KIND]: {
        run: () => {
          started = true;
          return hangs;
        },
      },
    },
    { deadlineSec: 600, tickMs: 60_000 },
  );

  await lock.query('BEGIN');
  await lock.query('LOCK TABLE jobs IN SHARE MODE');
  w.launch();
  // The occupation now stands in the lock.
  for (let i = 0; i < 50; i++) {
    const r = await db.get(`SELECT count(*)::int AS n FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
                             WHERE c.relname = 'jobs' AND NOT l.granted
                               AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())`);
    if (r.n > 0) break;
    await sleep(20);
  }
  const stopped = w.stop(3000);
  await sleep(200);
  await lock.query('COMMIT');
  await stopped;
  await sleep(300);

  const z = await db.get('SELECT status FROM jobs WHERE id = $1', [id]);
  assert.equal(started, false, 'after stoppe() no handler starts anymore');
  assert.notEqual(z.status, 'running', 'the job does not stay claimed');
});
