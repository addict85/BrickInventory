/**
 * The CSV import as a job: it decides only for its own calls
 * that the follow-up work per set is skipped, and it resumes after a restart.
 *
 * No process-wide counter of running imports: with it the follow-up work
 * would be skipped for EVERY account in the process as long as any import runs.
 *
 * Counter-checks (measured on 29.10.2026):
 *   A  the counter rebuilt (globalThis.__importe up and down again in runCsvImportFrom,
 *      addSetIntern only enqueues at 0) → red: “a
 *      set of another account gets its follow-up work during the import”
 *   B  setImportFort only for status 'running' → red: “an interrupted
 *      import resumes” (the run marked as orphaned stood still)
 *   C  in runCsvImportFrom `stand.current` not respected → red: “an
 *      interrupted import resumes” (r2 was booked a second time)
 *   C' (13.11.2026) C repeated with real adding and provided Rebrickable
 *      → red: “an interrupted import resumes” (91002-1 a second time)
 *   C" (14.11.2026) C, since adding no longer asks the network: the import is stuck at
 *      the held lock per set number → red: “an interrupted import resumes”
 *   D  (13.11.2026) in the worker the job without its account (inNamesOfJob with
 *      asRequest({})) → red: both subtests (the import does not see its state)
 *
 * As in production: the code under test queries as runtime role in the account (asAccount,
 * the worker via inNamesOfJob), the owner writes the test data.
 *
 * Rebrickable and the image fetch are provided at the wiring (testSources,
 * testImageWorker); adding runs for real.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// The import stops at the first set at the lock per set number as long as the test holds it.
let letGo = () => {};

const { buildAndRequire, testData, testAccess, asAccount, testSources, testImageWorker } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { warte } = require('./helpers/time');

test('CSV import as a job', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  // Adding asks no network; provided only so that a return to it would show.
  testSources(t, {
    holeSet: async () => {
      throw new Error('Netz beim Erfassen');
    },
  });
  const { lockUntilToEnd } = _req('db/txLock.js');
  const { LOCKS } = _req('src/infra/lockNamespaces.js');
  /** The lock setErfassen() takes per set number; held until loslassen(). */
  const sperre = { fertig: Promise.resolve() };
  const holdLock = (/** @type {string} */ sn) =>
    /** @type {Promise<void>} */ (
      new Promise(gehalten => {
        sperre.fertig = db.transaction(async (/** @type {any} */ tx) => {
          await lockUntilToEnd(tx, LOCKS.SET_ADD, sn);
          await new Promise(r => {
            letGo = () => r(undefined);
            gehalten(undefined);
          });
        });
      })
    );
  testImageWorker(t, { loadSetImage: async () => null });

  const dedupe_key = ['rebrickable_api_key', 'brickset_api_key', 'bricklink_consumer_key'];
  const vorher = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [dedupe_key]);
  await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [dedupe_key]);
  const konto = async name => {
    await db.run('DELETE FROM users WHERE username=$1', [name]);
    return (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [name])).id;
  };
  const a = await konto(`csvauftrag-a-${process.pid}`);
  const b = await konto(`csvauftrag-b-${process.pid}`);
  const { placeJobOne } = Object.assign({}, _req('src/jobQueue/jobs.js'), {
    ..._req('src/jobQueue/service.js'),
    ...require('./helpers/sources').testArea('jobQueue').jobs,
  });
  const { jobSet } = _req('src/jobQueue/importJob.js');
  const worker = _req('jobs/startJobs.js').startJobWorker(require('./helpers/sources').testServices(), {
    arten: ['csv_import'],
    taktMs: 50,
  });
  const nacharbeit = uid =>
    db.all(
      `SELECT payload->>'set_number' AS sn, payload->>'kind' AS type FROM jobs
      WHERE type = 'rework' AND user_id = $1 ORDER BY id`,
      [uid],
    );
  const state = () => db.get('SELECT status, done, results, current FROM import_status WHERE user_id=$1', [a]);
  const booked = (uid, nummern) =>
    db
      .all('SELECT set_number FROM sets WHERE user_id = $1 AND set_number = ANY($2) ORDER BY set_number', [
        uid,
        nummern,
      ])
      .then(z => z.map(x => x.set_number));
  const untilDone = async () => {
    for (let i = 0; i < 200; i++) {
      const s = await state();
      if (s?.status === 'done') return s;
      await warte(25);
    }
    return state();
  };

  try {
    await t.test('a set of another account gets its follow-up work during the import', async () => {
      await holdLock('76001-1');
      const lauf = `lauf-${process.pid}-1`;
      const rows = [{ sn: '76001-1', qty: 1, purchasePrice: null, condition: null, acquiredAt: null }];
      await asAccount(a, () =>
        jobSet(a, {
          status: 'running',
          total: 1,
          done: 0,
          current: null,
          results: '[]',
          error: null,
          run_id: lauf,
        }),
      );
      await placeJobOne('csv_import', { user_id: a, lauf, rows }, { userId: a });
      for (let i = 0; i < 100 && (await state())?.current !== '76001-1'; i++) await warte(20);
      assert.equal((await state())?.current, '76001-1', 'der Import steckt im ersten Set');

      const SN = `7${process.pid % 10000}-1`;
      const r = await asAccount(b, () =>
        require('./helpers/sources')
          .areaPage('sets')
          .acquireSet({ requester: b, setNumber: SN, quantity: 1, kaufpreis: 10, condition: 'N' }),
      );
      assert.equal(r.action, 'added');
      assert.deepEqual(await nacharbeit(b), [{ sn: SN, type: 'ergaenzen' }]);

      letGo();
      await sperre.fertig;
      assert.equal((await untilDone()).status, 'done');
      assert.deepEqual(
        await nacharbeit(a),
        [{ sn: '76001-1', type: 'csv' }],
        'der Import stellt seine Nacharbeit selbst ein',
      );
    });

    await t.test('an interrupted import continues', async () => {
      const lauf = `lauf-${process.pid}-2`;
      const [r1, r2, r3] = ['91001-1', '91002-1', '91003-1'];
      const rows = [r1, r2, r3].map(sn => ({
        sn,
        qty: 1,
        purchasePrice: null,
        condition: null,
        acquiredAt: null,
      }));
      // This is how it looks after a crash in the middle of r2: jobGet() has marked the run
      // as orphaned, the job stands at 'laeuft' with an expired deadline.
      await asAccount(a, () =>
        jobSet(a, {
          status: 'error',
          total: 3,
          done: 1,
          current: r2,
          error: 'unterbrochen',
          results: JSON.stringify([{ set_number: r1, success: true, action: 'added' }]),
          run_id: lauf,
        }),
      );
      await db.run(
        `INSERT INTO jobs (type, payload, user_id, status, attempts, deadline_at)
                    VALUES ('csv_import', $1, $2, 'running', 1, NOW() - INTERVAL '1 minute')`,
        [JSON.stringify({ user_id: a, lauf, rows }), a],
      );
      const s = await untilDone();
      assert.equal(s.status, 'done');
      assert.deepEqual(await booked(a, [r1, r2, r3]), [r3], 'r1 ist fertig, r2 ungewiss — gebucht wird nur r3');
      assert.deepEqual(
        s.results.map(z => [z.set_number, z.success, !!z.isWarning]),
        [
          [r1, true, false],
          [r2, false, true],
          [r3, true, false],
        ],
      );
    });
  } finally {
    letGo();
    await worker.stop(0);
    await testAccess().notification.close();
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[a, b]]);
    for (const z of vorher)
      await db.run('INSERT INTO global_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2', [
        z.key,
        z.value,
      ]);
    await db.pool.end().catch(() => {});
  }
});
