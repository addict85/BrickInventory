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
const { warte } = require('./helpers/time');

test('switching off during a claim', async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const A = { ..._req('src/jobQueue/service.js'), ...require('./helpers/sources').testArea('jobQueue').jobs };
  const { createWorker } = _req('jobs/jobWorker.js');
  const ART = `abschalten-${process.pid}`;
  const MARKE = `abschalten-${process.pid}`;
  // A test kind needs a schema for its payload like any other.
  require('./helpers/sources')
    .testServices()
    .jobQueue.registerKind({ kind: ART, payload: require('zod').looseObject({}), ausfuehren: async () => {} });
  await db.run('INSERT INTO job_types (type) VALUES ($1) ON CONFLICT DO NOTHING', [ART]);
  const sperre = await db.pool.connect();
  let letGo = () => {};
  const haengt = new Promise(r => {
    letGo = () => r(null);
  });
  t.after(async () => {
    letGo();
    await sperre.query('ROLLBACK').catch(() => {});
    sperre.release();
    await db.run(`DELETE FROM jobs WHERE payload->>'marke' = $1`, [MARKE]).catch(() => {});
    await testAccess()
      .notification.close()
      .catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const id = await A.placeJobOne(ART, { marke: MARKE });
  let started = false;
  // Hangs until the end of the test: a started job would thus stay at 'laeuft'.
  const w = createWorker(
    require('./helpers/sources').testServices().jobQueue,
    {
      [ART]: {
        ausfuehren: () => {
          started = true;
          return haengt;
        },
      },
    },
    { deadlineSec: 600, taktMs: 60_000 },
  );

  await sperre.query('BEGIN');
  await sperre.query('LOCK TABLE jobs IN SHARE MODE');
  w.starte();
  // The occupation now stands in the lock.
  for (let i = 0; i < 50; i++) {
    const r = await db.get(`SELECT count(*)::int AS n FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
                             WHERE c.relname = 'jobs' AND NOT l.granted
                               AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())`);
    if (r.n > 0) break;
    await warte(20);
  }
  const stopped = w.stop(3000);
  await warte(200);
  await sperre.query('COMMIT');
  await stopped;
  await warte(300);

  const z = await db.get('SELECT status FROM jobs WHERE id = $1', [id]);
  assert.equal(started, false, 'after stoppe() no handler starts anymore');
  assert.notEqual(z.status, 'running', 'the job does not stay claimed');
});
