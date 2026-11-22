'use strict';
/**
 * The worker holds a job's lease itself, exclusive kinds stay
 * single across connections, and an abort also reaches a
 * job that is currently waiting for a download.
 *
 * Counter-checks (measured 05.11.2026):
 *   A  in runJobFrom() `holdLease(...)` replaced by `() => {}` → red: “a
 *      job without its own heartbeat runs exactly once” (5 starts, status error_message)
 *   C  trigger job_exclusive_locks deleted (DROP TRIGGER) → red: “B occupies
 *      while A has not committed yet”
 *   D  in the worker `listen(JOB_STATUS_CHANNEL, …)` removed → red: “abort
 *      of a csv_sync in the download took 5000 ms”
 *   E  in abruf.ts the signal not respected → red: the same check (the
 *      run hung on the download)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');
const { warte, bis } = require('./helpers/time');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// The CSV download answers 200 and then delivers nothing more: a hanging CDN.
let downloadRunning = false;
const Module = require('node:module');
const _realRequire = Module.prototype.require;
Module.prototype.require = function (name, ...rest) {
  const m = _realRequire.call(this, name, ...rest);
  if (name.replace(/^node:/, '') !== 'https') return m;
  return {
    ...m,
    get: (_url, _opt, atResponse) => {
      const req = Object.assign(new EventEmitter(), { destroy: () => {} });
      downloadRunning = true;
      const res = Object.assign(new PassThrough(), {
        statusCode: 200,
        headers: { 'content-length': '1000000' },
        complete: false,
      });
      setImmediate(() => atResponse(res));
      return req;
    },
  };
};

const { buildAndRequire, testAccess } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

test('job lease, exclusivity and abort', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const A = Object.assign(
    {},
    { ..._req('src/jobQueue/service.js'), ...require('./helpers/sources').testArea('jobQueue').jobs },
  );
  const { createWorker } = _req('jobs/jobWorker.js');
  t.after(async () => {
    await testAccess().notification.close();
    await db.pool.end().catch(() => {});
  });

  await t.test('a job without its own sign of life runs exactly once', async () => {
    await db.run("DELETE FROM jobs WHERE type = 'exchange_rates'");
    let starts = 0;
    // Two workers like two processes: the second must not take over the row while the first works.
    // The work takes longer than the deadline (1 s): only the own heartbeat holds the row.
    const editor = {
      exchange_rates: {
        ausfuehren: async () => {
          starts++;
          await warte(4500);
        },
      },
    };
    const w = createWorker(require('./helpers/sources').testServices().jobQueue, editor, {
      parallel: 2,
      deadlineSec: 1,
      taktMs: 300,
    });
    const w2 = createWorker(require('./helpers/sources').testServices().jobQueue, editor, {
      parallel: 2,
      deadlineSec: 1,
      taktMs: 300,
    });
    const id = await A.placeJobOne('exchange_rates', {}, { schluessel: `pacht-${process.pid}` });
    const status = async () => (await db.get('SELECT status FROM jobs WHERE id = $1', [id])).status;
    w.starte();
    await bis(async () => (await status()) === 'running');
    w2.starte();
    await bis(async () => (await status()) === 'done', 8000);
    await w.stop(100);
    await w2.stop(100);
    const z = await db.get('SELECT status, attempts FROM jobs WHERE id = $1', [id]);
    assert.deepEqual(
      { starts, ...z },
      { starts: 1, status: 'done', attempts: 1 },
      'ein Auftrag ohne eigenes Lebenszeichen läuft genau einmal',
    );
  });

  await t.test('the second connection claims no second csv_sync', async () => {
    await db.run("DELETE FROM jobs WHERE type = 'csv_sync'");
    await db.run(
      `INSERT INTO jobs (type, payload, dedupe_key) VALUES ('csv_sync', '{}', 'x1'), ('csv_sync', '{}', 'x2')`,
    );
    const a = await db.pool.connect();
    try {
      await a.query('BEGIN');
      // Connection A occupies and keeps its transaction open; B occupies via the service.
      const ra =
        await a.query(`UPDATE jobs SET status = 'running', locked_by = 'A', deadline_at = NOW() + INTERVAL '5 min'
                                 WHERE dedupe_key = 'x1' RETURNING id`);
      assert.equal(ra.rowCount, 1);
      assert.equal(
        await A.claimJob(['csv_sync'], 60, 'B', ['csv_sync']),
        null,
        'B belegt, solange A noch nicht festgeschrieben hat',
      );
      await a.query('COMMIT');
    } finally {
      a.release();
    }
    assert.equal(await A.claimJob(['csv_sync'], 60, 'B', ['csv_sync']), null, 'B belegt nach dem Festschreiben von A');
    const laufend = await db.all("SELECT locked_by FROM jobs WHERE type = 'csv_sync' AND status = 'running'");
    assert.deepEqual(
      laufend.map(z => z.locked_by),
      ['A'],
      'die zweite Verbindung belegt keinen zweiten csv_sync',
    );
    await db.run("DELETE FROM jobs WHERE type = 'csv_sync'");
  });

  await t.test('aborting a csv_sync during the download ends in at most 2 s', async () => {
    await db.run("DELETE FROM jobs WHERE type = 'csv_sync'");
    const EDITOR = _req('jobs/startJobs.js').editor(require('./helpers/sources').testServices());
    const w = createWorker(
      require('./helpers/sources').testServices().jobQueue,
      { csv_sync: EDITOR.csv_sync },
      { deadlineSec: 60, taktMs: 100 },
    );
    const id = await A.placeJobOne('csv_sync', {});
    downloadRunning = false;
    w.starte();
    t.after(() => w.stop(0));
    await bis(() => w.running() > 0);
    assert.equal(w.running(), 1, 'der Abgleich läuft');
    assert.ok(await bis(() => downloadRunning), 'der Download hat begonnen');
    const start = Date.now();
    assert.ok(await A.abortAb(id));
    await bis(() => w.running() === 0);
    const duration = Date.now() - start;
    assert.ok(duration <= 2000, `Abbruch eines csv_sync im Download dauerte ${duration} ms`);
    assert.equal((await db.get('SELECT status FROM jobs WHERE id = $1', [id])).status, 'cancelled');
  });
});
