/**
 * The CSV import books no set twice: after a timeout there is
 * no retry, and a run superseded by a new import stops
 * instead of continuing to write into the same status line.
 *
 * The import runs as a job (src/sets/csvImportRun.ts); the test starts the
 * worker for it itself, restricted to the kind csv_import.
 *
 * Counter-checks (measured on 28.10.2026, repeated on 29.10. after the move into the
 * job — both red again):
 *   A  `isTimeout` back into the retry condition → red: “after a
 *      timeout no second attempt” (2 calls)
 *   B  jobUpdate in the loop without `lauf` (all three calls in
 *      runCsvImportFrom) → red: “a superseded run stops” (the old
 *      run kept booking all five sets)
 *
 * Adding runs for real; Rebrickable (testSources) and the image fetch are provided.
 *   A, B repeated on 13.11.2026 with real adding: both red again.
 *   B' (14.11.2026) since adding asks no network, the test holds the lock per
 *      set number instead of the network; B repeated → red (the file does not end within its deadline).
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.CSV_ROW_DEADLINE_MS = '150';

const { buildAndRequire, testData, testAccess, testSources, testImageWorker } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();
const { warte, bis } = require('./helpers/time');

test('CSV import: no double booking', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  // Adding asks no network; the held lock per set number makes a line slow.
  testSources(t, {
    holeSet: async () => {
      throw new Error('Network during capture');
    },
  });
  const { lockUntilToEnd } = _req('db/txLock.js');
  const { LOCKS } = _req('src/infra/lockNamespaces.js');
  /** @type {() => void} */
  let letGo = () => {};
  /** Holds the lock of acquireSet() for `sn` until loslassen(); returns the end of the transaction. */
  const hold = async (/** @type {string} */ sn) => {
    /** @type {Promise<unknown>} */
    let ende = Promise.resolve();
    await /** @type {Promise<void>} */ (
      new Promise(gehalten => {
        ende = db.transaction(async (/** @type {any} */ tx) => {
          await lockUntilToEnd(tx, LOCKS.SET_ADD, sn);
          await new Promise(r => {
            letGo = () => r(undefined);
            gehalten(undefined);
          });
        });
      })
    );
    return { ende };
  };
  const booked = async (/** @type {string} */ praefix) =>
    (
      await db.all(`SELECT set_number FROM set_acquisitions WHERE user_id = $1 AND set_number LIKE $2`, [
        uid,
        `${praefix}%`,
      ])
    ).map((/** @type {any} */ z) => z.set_number);
  testImageWorker(t, { loadSetImage: async () => null });
  const NAME = `csvlauf-${process.pid}`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  const { base } = testServer(_req, { sitzung: { userId: uid }, t });
  const worker = _req('jobs/startJobs.js').startJobWorker(require('./helpers/sources').testServices(), {
    arten: ['csv_import'],
    taktMs: 50,
  });

  const importIt = async zeilen => {
    const fd = new FormData();
    fd.append('file', new Blob(['set_number,quantity\n' + zeilen.map(z => `${z},1`).join('\n')]), 'import.csv');
    const r = await fetch(`${base}/api/v2/sets/import/csv`, { method: 'POST', body: fd });
    assert.equal(r.status, 200, await r.text());
  };
  const auftrag = () => db.get('SELECT status, done, results FROM import_status WHERE user_id=$1', [uid]);
  const untilDone = async () => {
    for (let i = 0; i < 100; i++) {
      const a = await auftrag();
      if (a?.status !== 'running') return a;
      await warte(50);
    }
    return auftrag();
  };

  try {
    await t.test('no second attempt after a timeout', async () => {
      const { ende } = await hold('70001-1');
      await importIt(['70001-1']);
      const a = await untilDone();
      letGo();
      await ende;
      await warte(300);
      assert.deepEqual(await booked('70001'), ['70001-1'], 'exactly one booking, no second attempt');
      assert.equal(a.results[0].isWarning, true, 'the row ends as a warning');
    });

    await t.test('a superseded run stops', async () => {
      const { ende: lockEnd } = await hold('71002-1');
      await importIt(['71001-1', '71002-1', '71003-1', '71004-1', '71005-1']);
      assert.ok(await bis(async () => (await booked('71')).length > 0), 'the first run already books');
      await importIt(['72001-1']);
      const a = await untilDone();
      letGo();
      await lockEnd;
      await warte(700);
      const alte = await booked('71');
      assert.ok(alte.length <= 2, `the old run kept booking: ${alte.join(', ')}`);
      const ende = await auftrag();
      assert.equal(ende.status, 'done');
      assert.deepEqual(
        ende.results.map(r => r.set_number),
        ['72001-1'],
        'the row belongs to the new run',
      );
      assert.equal(a.done, 1);
    });
  } finally {
    await worker.stop(0);
    await testAccess().notification.close();
    await db.run('DELETE FROM users WHERE id=$1', [uid]);
    await db.pool.end().catch(() => {});
  }
});
