/**
 * Der CSV-Import bucht kein Set doppelt: Nach einer Zeitüberschreitung wird
 * nicht erneut versucht, und ein von einem neuen Import abgelöster Lauf hört
 * auf, statt weiter in dieselbe Statuszeile zu schreiben.
 *
 * Der Import läuft als Auftrag (src/sets/csvImportLauf.ts); der Test startet den
 * Worker dafür selbst, beschränkt auf die Art csv_import.
 *
 * Gegenproben (am 28.10.2026 gemessen, am 29.10. nach dem Umzug in den
 * Auftrag wiederholt — beide wieder rot):
 *   A  `isTimeout` wieder in die Wiederholungsbedingung → rot: „nach einer
 *      Zeitüberschreitung kein zweiter Versuch“ (2 Aufrufe)
 *   B  jobUpdate in der Schleife ohne `lauf` (alle drei Aufrufe in
 *      fuehreCsvImportAus) → rot: „ein abgelöster Lauf hört auf“ (der alte
 *      Lauf buchte alle fünf Sets weiter)
 *
 * Das Erfassen läuft echt; gestellt sind Rebrickable (testQuellen) und der Bildabruf.
 *   A, B am 13.11.2026 mit echtem Erfassen wiederholt: beide wieder rot.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.CSV_ZEILE_FRIST_MS = '150';

// Rebrickable gestellt: Jede Katalogfrage wird gezählt und dauert `dauer` ms.
const aufrufe = [];
let dauer = 0;

const { buildAndRequire, testDaten, testZugang, testQuellen, testBildwerk } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testDaten();
const { warte, bis } = require('./helpers/zeit');

test('CSV-Import: keine Doppelbuchung', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
  testQuellen(t, {
    holeSet: async sn => {
      aufrufe.push(sn);
      await warte(dauer);
      return null;
    },
  });
  testBildwerk(t, { setBildLaden: async () => null });
  const NAME = `csvlauf-${process.pid}`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  const { base } = testServer(_req, { sitzung: { userId: uid }, t });
  const worker = _req('jobs/auftraegeStarten.js').starteAuftragsWorker(require('./helpers/sources').testDienste(), {
    arten: ['csv_import'],
    taktMs: 50,
  });

  const importiere = async zeilen => {
    const fd = new FormData();
    fd.append('file', new Blob(['set_number,quantity\n' + zeilen.map(z => `${z},1`).join('\n')]), 'import.csv');
    const r = await fetch(`${base}/api/v1/sets/import/csv`, { method: 'POST', body: fd });
    assert.equal(r.status, 200, await r.text());
  };
  const auftrag = () => db.get('SELECT status, done, results FROM import_stand WHERE user_id=$1', [uid]);
  const bisFertig = async () => {
    for (let i = 0; i < 100; i++) {
      const a = await auftrag();
      if (a?.status !== 'running') return a;
      await warte(50);
    }
    return auftrag();
  };

  try {
    await t.test('nach einer Zeitüberschreitung kein zweiter Versuch', async () => {
      aufrufe.length = 0;
      dauer = 400;
      await importiere(['70001-1']);
      const a = await bisFertig();
      await warte(800);
      assert.deepEqual(aufrufe, ['70001-1']);
      assert.equal(a.results[0].isWarning, true, 'die Zeile endet als Warnung');
    });

    await t.test('ein abgelöster Lauf hört auf', async () => {
      aufrufe.length = 0;
      dauer = 100;
      await importiere(['71001-1', '71002-1', '71003-1', '71004-1', '71005-1']);
      assert.ok(await bis(() => aufrufe.length > 0), 'der erste Lauf bucht schon');
      await importiere(['72001-1']);
      const a = await bisFertig();
      await warte(700);
      const alte = aufrufe.filter(s => s.startsWith('71'));
      assert.ok(alte.length <= 2, `der alte Lauf buchte weiter: ${alte.join(', ')}`);
      const ende = await auftrag();
      assert.equal(ende.status, 'done');
      assert.deepEqual(
        ende.results.map(r => r.set_number),
        ['72001-1'],
        'die Zeile gehört dem neuen Lauf',
      );
      assert.equal(a.done, 1);
    });
  } finally {
    await worker.stoppe(0);
    await testZugang().benachrichtigung.close();
    await db.run('DELETE FROM users WHERE id=$1', [uid]);
    await db.pool.end().catch(() => {});
  }
});
