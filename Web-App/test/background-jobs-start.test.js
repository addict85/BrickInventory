/**
 * The start of the job process registers every background job as a job.
 *
 * Counter-checks (measured on 30.10.2026):
 *   A  in startJobs() `pullPlanBefore('csv_sync', …)` removed → red: “every
 *      scheduled kind has a date” (the catalog was only due at 03:00).
 *      Removing `planeAll()` alone stays green: today the start pulls forward
 *      every scheduled kind and creates it in the process; planeAll() covers a
 *      future kind that is not pulled forward.
 *   B  in startJobs() the loop over FOLLOWUP_RUNS removed → red: “every
 *      follow-up run is enqueued once”
 *   C  startJobWorker() removed from startJobs() → red: “the worker starts”
 *   D  (05.11.2026) the heartbeat written without looking at the worker →
 *      red: “the heartbeat follows the worker” (it came even without a worker)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

let workerStarted = 0;
const realRequire = Module.prototype.require;
Module.prototype.require = function (name, ...rest) {
  const m = realRequire.call(this, name, ...rest);
  if (typeof name === 'string' && /jobs[/\\]startJobs(\.js)?$/.test(name))
    return {
      ...m,
      startJobWorker: () => {
        workerStarted++;
        return { lastRound: () => Date.now(), stop: async () => {} };
      },
    };
  return m;
};

const { buildAndRequire, testData, testAccess } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const { warte } = require('./helpers/time');

test('starting the job process queues everything as a job', { concurrency: 1 }, async t => {
  const db = testData();
  /** What startJobs returns: the test holds it like server.ts. */
  const runs = [];
  t.after(async () => {
    for (const lauf of runs)
      await _req('startup/jobsProcess.js').stopJobs(require('./helpers/sources').testServices(), lauf);
    await testAccess()
      .notification.close()
      .catch(() => {});
    await db.pool.end().catch(() => {});
    Module.prototype.require = realRequire;
  });
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  await db.run('DELETE FROM jobs');
  runs.push(await _req('startup/jobsProcess.js').startJobs(require('./helpers/sources').testServices()));

  const zeilen = await db.all(`SELECT type, dedupe_key, payload, EXTRACT(EPOCH FROM due_at - NOW())::int AS in_sek
                                 FROM jobs WHERE status = 'offen'`);
  const plan = type => zeilen.find(z => z.dedupe_key === `plan:${type}`);

  await t.test('every scheduled kind has an appointment', () => {
    for (const { art } of require('./helpers/sources')
      .testServices()
      .jobQueue.signedInKinds()
      .filter(a => a.zeitplan))
      assert.ok(plan(art), `kein Termin für ${art}; da sind: ${zeilen.map(z => z.dedupe_key).join(', ')}`);
    assert.ok(
      plan('csv_sync').in_sek <= 0 && plan('csv_sync').payload.onStart,
      'der Katalog wird beim Start sofort geprüft',
    );
    assert.ok(plan('preise').in_sek <= 30, 'der Preis-Job läuft 30 s nach dem Start');
    assert.ok(
      zeilen.some(z => z.type === 'wechselkurse'),
      'kein Wechselkurs-Auftrag',
    );
  });

  await t.test('every follow-up run is queued once', async () => {
    const { FOLLOWUP_RUNS } = _req('src/management/startFollowUpRuns.js');
    for (const schritt of Object.keys(FOLLOWUP_RUNS))
      assert.ok(
        zeilen.some(z => z.dedupe_key === `nachlauf:${schritt}`),
        `Nachlauf ${schritt} fehlt`,
      );
    runs.push(await _req('startup/jobsProcess.js').startJobs(require('./helpers/sources').testServices()));
    const doppelt = await db.get(`SELECT COUNT(*)::int AS n FROM jobs WHERE status = 'offen'
                                    GROUP BY dedupe_key HAVING COUNT(*) > 1 LIMIT 1`);
    assert.equal(doppelt, undefined, 'ein zweiter Start legt Termine doppelt an');
  });

  await t.test('the worker starts', () => {
    assert.ok(workerStarted >= 1);
  });

  await t.test('the sign of life follows the worker', async () => {
    const jp = _req('startup/jobsProcess.js');
    const { liesZustand, deleteState } = require('./helpers/sources').testArea('jobQueue').laufzustand;
    for (let i = 0; i < 50 && !(await liesZustand(jp.HEARTBEAT_KEY)); i++) await warte(20);
    assert.ok(await liesZustand(jp.HEARTBEAT_KEY), 'nach dem Start fehlt das Lebenszeichen');
    for (const lauf of runs) await jp.stopJobs(require('./helpers/sources').testServices(), lauf);
    await deleteState(jp.HEARTBEAT_KEY);
    await jp.renewHeartbeat(require('./helpers/sources').testServices(), runs[0].worker);
    assert.equal(await liesZustand(jp.HEARTBEAT_KEY), null, 'ohne Worker kein Lebenszeichen');
  });
});
