/**
 * Der CSV-Import als Auftrag: Er entscheidet nur für seine eigenen Aufrufe,
 * dass die Nacharbeit je Set ausfällt, und er setzt nach einem Neustart fort.
 *
 * Kein prozessweiter Zähler laufender Importe: Mit ihm fiele die Nacharbeit
 * für JEDES Konto im Prozess aus, solange irgendein Import läuft.
 *
 * Gegenproben (am 29.10.2026 gemessen):
 *   A  den Zähler nachgebaut (globalThis.__importe in runCsvImportFrom hoch
 *      und wieder herunter, addSetIntern stellt nur bei 0 ein) → rot: „ein
 *      Set eines anderen Kontos bekommt während des Imports seine Nacharbeit“
 *   B  setImportFort nur für status 'running' → rot: „ein unterbrochener
 *      Import setzt fort“ (der als verwaist markierte Lauf blieb stehen)
 *   C  in runCsvImportFrom `stand.current` nicht beachtet → rot: „ein
 *      unterbrochener Import setzt fort“ (r2 wurde ein zweites Mal gebucht)
 *   C' (13.11.2026) C mit echtem Erfassen und gestelltem Rebrickable wiederholt
 *      → rot: „ein unterbrochener Import setzt fort“ (91002-1 ein zweites Mal)
 *   C" (14.11.2026) C, seit das Erfassen kein Netz mehr fragt: Der Import steckt an
 *      der gehaltenen Sperre je Setnummer → rot: „ein unterbrochener Import setzt fort“
 *   D  (13.11.2026) im Worker den Auftrag ohne sein Konto (inNamesOfJob mit
 *      asRequest({})) → rot: beide Teiltests (der Import sieht seinen Stand nicht)
 *
 * Wie im Betrieb: Der Code unter Test fragt als Laufzeitrolle im Konto (asAccount,
 * der Worker über inNamesOfJob), Testdaten schreibt die Eigentümerin.
 *
 * Rebrickable und der Bildabruf sind an der Verdrahtung gestellt (testSources,
 * testImageWorker); das Erfassen läuft echt.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// Der Import hält im ersten Set an der Sperre je Setnummer, solange der Test sie hält.
let loslassen = () => {};

const { buildAndRequire, testData, testAccess, asAccount, testSources, testImageWorker } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { warte } = require('./helpers/zeit');

test('CSV-Import als Auftrag', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  // Erfassen fragt kein Netz; gestellt nur, damit eine Rückkehr dorthin auffiele.
  testSources(t, {
    holeSet: async () => {
      throw new Error('Netz beim Erfassen');
    },
  });
  const { lockUntilToEnd } = _req('db/txLock.js');
  const { LOCKS } = _req('src/infra/lockNamespaces.js');
  /** Die Sperre, die setErfassen() je Setnummer nimmt; gehalten bis loslassen(). */
  const sperre = { fertig: Promise.resolve() };
  const holdLock = (/** @type {string} */ sn) =>
    /** @type {Promise<void>} */ (
      new Promise(gehalten => {
        sperre.fertig = db.transaction(async (/** @type {any} */ tx) => {
          await lockUntilToEnd(tx, LOCKS.SET_ADD, sn);
          await new Promise(r => {
            loslassen = () => r(undefined);
            gehalten(undefined);
          });
        });
      })
    );
  testImageWorker(t, { setBildLaden: async () => null });

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
    ...require('./helpers/sources').testArea('jobQueue').auftraege,
  });
  const { jobSet } = _req('src/jobQueue/importJob.js');
  const worker = _req('jobs/startJobs.js').startJobWorker(require('./helpers/sources').testServices(), {
    arten: ['csv_import'],
    taktMs: 50,
  });
  const nacharbeit = uid =>
    db.all(
      `SELECT payload->>'set_number' AS sn, payload->>'art' AS type FROM jobs
      WHERE type = 'nacharbeit' AND user_id = $1 ORDER BY id`,
      [uid],
    );
  const stand = () => db.get('SELECT status, done, results, current FROM import_status WHERE user_id=$1', [a]);
  const booked = (uid, nummern) =>
    db
      .all('SELECT set_number FROM sets WHERE user_id = $1 AND set_number = ANY($2) ORDER BY set_number', [
        uid,
        nummern,
      ])
      .then(z => z.map(x => x.set_number));
  const untilDone = async () => {
    for (let i = 0; i < 200; i++) {
      const s = await stand();
      if (s?.status === 'done') return s;
      await warte(25);
    }
    return stand();
  };

  try {
    await t.test('ein Set eines anderen Kontos bekommt während des Imports seine Nacharbeit', async () => {
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
      for (let i = 0; i < 100 && (await stand())?.current !== '76001-1'; i++) await warte(20);
      assert.equal((await stand())?.current, '76001-1', 'der Import steckt im ersten Set');

      const SN = `7${process.pid % 10000}-1`;
      const r = await asAccount(b, () =>
        require('./helpers/sources')
          .areaPage('sets')
          .setErfassen({ requester: b, setNumber: SN, menge: 1, kaufpreis: 10, zustand: 'N' }),
      );
      assert.equal(r.action, 'added');
      assert.deepEqual(await nacharbeit(b), [{ sn: SN, type: 'ergaenzen' }]);

      loslassen();
      await sperre.fertig;
      assert.equal((await untilDone()).status, 'done');
      assert.deepEqual(
        await nacharbeit(a),
        [{ sn: '76001-1', type: 'csv' }],
        'der Import stellt seine Nacharbeit selbst ein',
      );
    });

    await t.test('ein unterbrochener Import setzt fort', async () => {
      const lauf = `lauf-${process.pid}-2`;
      const [r1, r2, r3] = ['91001-1', '91002-1', '91003-1'];
      const rows = [r1, r2, r3].map(sn => ({
        sn,
        qty: 1,
        purchasePrice: null,
        condition: null,
        acquiredAt: null,
      }));
      // So sieht es nach einem Absturz mitten in r2 aus: jobGet() hat den Lauf
      // als verwaist markiert, der Auftrag steht auf 'laeuft' mit abgelaufener Frist.
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
                    VALUES ('csv_import', $1, $2, 'laeuft', 1, NOW() - INTERVAL '1 minute')`,
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
    loslassen();
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
