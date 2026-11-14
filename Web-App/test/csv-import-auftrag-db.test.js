/**
 * Der CSV-Import als Auftrag: Er entscheidet nur für seine eigenen Aufrufe,
 * dass die Nacharbeit je Set ausfällt, und er setzt nach einem Neustart fort.
 *
 * Kein prozessweiter Zähler laufender Importe: Mit ihm fiele die Nacharbeit
 * für JEDES Konto im Prozess aus, solange irgendein Import läuft.
 *
 * Gegenproben (am 29.10.2026 gemessen):
 *   A  den Zähler nachgebaut (globalThis.__importe in fuehreCsvImportAus hoch
 *      und wieder herunter, addSetIntern stellt nur bei 0 ein) → rot: „ein
 *      Set eines anderen Kontos bekommt während des Imports seine Nacharbeit“
 *   B  setzeImportFort nur für status 'running' → rot: „ein unterbrochener
 *      Import setzt fort“ (der als verwaist markierte Lauf blieb stehen)
 *   C  in fuehreCsvImportAus `stand.current` nicht beachtet → rot: „ein
 *      unterbrochener Import setzt fort“ (r2 wurde ein zweites Mal gebucht)
 *   C' (13.11.2026) C mit echtem Erfassen und gestelltem Rebrickable wiederholt
 *      → rot: „ein unterbrochener Import setzt fort“ (91002-1 ein zweites Mal)
 *   D  (13.11.2026) im Worker den Auftrag ohne sein Konto (imNamenDesAuftrags mit
 *      alsAnfrage({})) → rot: beide Teiltests (der Import sieht seinen Stand nicht)
 *
 * Wie im Betrieb: Der Code unter Test fragt als Laufzeitrolle im Konto (alsKonto,
 * der Worker über imNamenDesAuftrags), Testdaten schreibt die Eigentümerin.
 *
 * Rebrickable und der Bildabruf sind an der Verdrahtung gestellt (testQuellen,
 * testBildwerk); das Erfassen läuft echt.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// Rebrickable gestellt: Jede Katalogfrage wird gezählt und wartet auf `freigabe`.
const aufrufe = [];
let freigabe = Promise.resolve();
let loslassen = () => {};

const { buildAndRequire, testDaten, testZugang, alsKonto, testQuellen, testBildwerk } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const db = testDaten();
const { warte } = require('./helpers/zeit');

test('CSV-Import als Auftrag', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
  testQuellen(t, {
    // Nur das Set des Imports wartet; das Set des anderen Kontos geht durch.
    holeSet: async sn => {
      aufrufe.push(sn);
      if (sn === '76001-1') await freigabe;
      return null;
    },
  });
  testBildwerk(t, { setBildLaden: async () => null });

  const schluessel = ['rebrickable_api_key', 'brickset_api_key', 'bricklink_consumer_key'];
  const vorher = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [schluessel]);
  await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [schluessel]);
  const konto = async name => {
    await db.run('DELETE FROM users WHERE username=$1', [name]);
    return (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [name])).id;
  };
  const a = await konto(`csvauftrag-a-${process.pid}`);
  const b = await konto(`csvauftrag-b-${process.pid}`);
  const { stelleAuftragEin } = Object.assign({}, _req('src/auftraege/auftraege.js'), {
    ..._req('src/auftraege/dienst.js'),
    ...require('./helpers/sources').testBereich('auftraege').auftraege,
  });
  const { jobSet } = _req('src/auftraege/importAuftrag.js');
  const worker = _req('jobs/auftraegeStarten.js').starteAuftragsWorker(require('./helpers/sources').testDienste(), {
    arten: ['csv_import'],
    taktMs: 50,
  });
  const nacharbeit = uid =>
    db.all(
      `SELECT nutzlast->>'set_number' AS sn, nutzlast->>'art' AS art FROM auftraege
      WHERE art = 'nacharbeit' AND user_id = $1 ORDER BY id`,
      [uid],
    );
  const stand = () => db.get('SELECT status, done, results, current FROM import_stand WHERE user_id=$1', [a]);
  const bisFertig = async () => {
    for (let i = 0; i < 200; i++) {
      const s = await stand();
      if (s?.status === 'done') return s;
      await warte(25);
    }
    return stand();
  };

  try {
    await t.test('ein Set eines anderen Kontos bekommt während des Imports seine Nacharbeit', async () => {
      aufrufe.length = 0;
      freigabe = new Promise(r => {
        loslassen = r;
      });
      const lauf = `lauf-${process.pid}-1`;
      const rows = [{ sn: '76001-1', qty: 1, purchasePrice: null, condition: null, acquiredAt: null }];
      await alsKonto(a, () =>
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
      await stelleAuftragEin('csv_import', { user_id: a, lauf, rows }, { userId: a });
      for (let i = 0; i < 100 && !aufrufe.length; i++) await warte(20);
      assert.deepEqual(aufrufe, ['76001-1'], 'der Import steckt im ersten Set');

      const SN = `7${process.pid % 10000}-1`;
      const r = await alsKonto(b, () =>
        require('./helpers/sources')
          .bereichsSeite('sets')
          .addSet({ setNumber: SN, menge: 1, konto: b, kaufpreis: 10, zustand: 'N' }),
      );
      assert.equal(r.action, 'added');
      assert.deepEqual(await nacharbeit(b), [{ sn: SN, art: 'neu' }]);

      loslassen();
      assert.equal((await bisFertig()).status, 'done');
      assert.deepEqual(
        await nacharbeit(a),
        [{ sn: '76001-1', art: 'csv' }],
        'der Import stellt seine Nacharbeit selbst ein',
      );
    });

    await t.test('ein unterbrochener Import setzt fort', async () => {
      aufrufe.length = 0;
      freigabe = Promise.resolve();
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
      await alsKonto(a, () =>
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
        `INSERT INTO auftraege (art, nutzlast, user_id, status, versuche, frist_bis)
                    VALUES ('csv_import', $1, $2, 'laeuft', 1, NOW() - INTERVAL '1 minute')`,
        [JSON.stringify({ user_id: a, lauf, rows }), a],
      );
      const s = await bisFertig();
      assert.equal(s.status, 'done');
      assert.deepEqual(aufrufe, [r3], 'r1 ist fertig, r2 ungewiss — gebucht wird nur r3');
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
    await worker.stoppe(0);
    await testZugang().benachrichtigung.close();
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[a, b]]);
    for (const z of vorher)
      await db.run('INSERT INTO global_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2', [
        z.key,
        z.value,
      ]);
    await db.pool.end().catch(() => {});
  }
});
