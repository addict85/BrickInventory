/**
 * Der Start des Job-Prozesses trägt jede Hintergrundarbeit als Auftrag ein.
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  in startJobs() `pullPlanBefore('csv_sync', …)` entfernt → rot: „jede
 *      geplante Art hat einen Termin“ (der Katalog stand erst um 03:00 an).
 *      `planeAll()` allein zu entfernen bleibt grün: Heute zieht der Start
 *      jede geplante Art vor und legt sie dabei an; planeAll() deckt eine
 *      künftige Art ab, die nicht vorgezogen wird.
 *   B  in startJobs() die Schleife über FOLLOWUP_RUNS entfernt → rot: „jeder
 *      Nachlauf ist einmal eingestellt“
 *   C  startJobWorker() aus startJobs() entfernt → rot: „der Worker läuft an“
 *   D  (05.11.2026) das Lebenszeichen ohne Blick auf den Worker geschrieben →
 *      rot: „das Lebenszeichen folgt dem Worker“ (es kam auch ohne Worker)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

let workerStarted = 0;
const realRequire = Module.prototype.require;
Module.prototype.require = function (name, ...rest) {
  const m = realRequire.call(this, name, ...rest);
  if (typeof name === 'string' && /jobs[/\\]auftraegeStarten(\.js)?$/.test(name))
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
const { warte } = require('./helpers/zeit');

test('der Start des Job-Prozesses stellt alles als Auftrag ein', { concurrency: 1 }, async t => {
  const db = testData();
  /** Was startJobs zurückgibt: Der Test hält es wie server.ts. */
  const runs = [];
  t.after(async () => {
    for (const lauf of runs)
      await _req('startup/jobsProzess.js').stopJobs(require('./helpers/sources').testServices(), lauf);
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
  runs.push(await _req('startup/jobsProzess.js').startJobs(require('./helpers/sources').testServices()));

  const zeilen = await db.all(`SELECT type, dedupe_key, payload, EXTRACT(EPOCH FROM due_at - NOW())::int AS in_sek
                                 FROM jobs WHERE status = 'offen'`);
  const plan = type => zeilen.find(z => z.dedupe_key === `plan:${type}`);

  await t.test('jede geplante Art hat einen Termin', () => {
    for (const { art } of require('./helpers/sources')
      .testServices()
      .auftraege.signedInKinds()
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

  await t.test('jeder Nachlauf ist einmal eingestellt', async () => {
    const { FOLLOWUP_RUNS } = _req('src/management/startFollowUpRuns.js');
    for (const schritt of Object.keys(FOLLOWUP_RUNS))
      assert.ok(
        zeilen.some(z => z.dedupe_key === `nachlauf:${schritt}`),
        `Nachlauf ${schritt} fehlt`,
      );
    runs.push(await _req('startup/jobsProzess.js').startJobs(require('./helpers/sources').testServices()));
    const doppelt = await db.get(`SELECT COUNT(*)::int AS n FROM jobs WHERE status = 'offen'
                                    GROUP BY dedupe_key HAVING COUNT(*) > 1 LIMIT 1`);
    assert.equal(doppelt, undefined, 'ein zweiter Start legt Termine doppelt an');
  });

  await t.test('der Worker läuft an', () => {
    assert.ok(workerStarted >= 1);
  });

  await t.test('das Lebenszeichen folgt dem Worker', async () => {
    const jp = _req('startup/jobsProzess.js');
    const { liesZustand, deleteState } = require('./helpers/sources').testArea('auftraege').laufzustand;
    for (let i = 0; i < 50 && !(await liesZustand(jp.HEARTBEAT_KEY)); i++) await warte(20);
    assert.ok(await liesZustand(jp.HEARTBEAT_KEY), 'nach dem Start fehlt das Lebenszeichen');
    for (const lauf of runs) await jp.stopJobs(require('./helpers/sources').testServices(), lauf);
    await deleteState(jp.HEARTBEAT_KEY);
    await jp.renewHeartbeat(require('./helpers/sources').testServices(), runs[0].worker);
    assert.equal(await liesZustand(jp.HEARTBEAT_KEY), null, 'ohne Worker kein Lebenszeichen');
  });
});
