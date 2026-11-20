/**
 * Ein Job-Prozess, der hart endet, gibt seine laufenden Aufträge nicht zurück.
 * Der nächste Start übernimmt sie sofort, nicht erst nach der Frist; Aufträge
 * eines lebenden Prozesses und die eigenen bleiben, wo sie sind.
 *
 * Gegenproben (06.11.2026):
 *   A  in giveOrphanedBack() die Abfrage pg_try_advisory_lock durch `true`
 *      ersetzt → rot: „ein lebender Prozess behält seinen Auftrag“
 *   B  in giveOrphanedBack() das UPDATE gestrichen → rot: „der Start
 *      übernimmt den Auftrag eines toten Prozesses“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();

test('Aufträge toter Job-Prozesse', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const prozess = _req('src/jobQueue/process.js');
  const { LOCKS } = _req('src/infra/lockNamespaces.js');
  const alive = await db.pool.connect();
  t.after(async () => {
    prozess.reportProcessAb();
    alive.release(true);
    await db.pool.end().catch(() => {});
  });
  await alive.query('SELECT pg_advisory_lock($1, hashtext($2))', [LOCKS.JOB_PROCESS, 'lebender-prozess']);

  const laufend = async occupiedOf =>
    (
      await db.get(
        `INSERT INTO jobs (type, payload, status, locked_by, deadline_at, started_at, attempts)
     VALUES ('aufraeumen', '{}', 'laeuft', $1, NOW() + interval '5 minutes', NOW(), 1) RETURNING id`,
        [occupiedOf],
      )
    ).id;
  const tot = await laufend('toter-prozess/1');
  const anderer = await laufend('lebender-prozess/2');
  const eigener = await laufend(`${prozess.PROCESS}/3`);
  const status = async id => (await db.get('SELECT status FROM jobs WHERE id = $1', [id])).status;

  // Was startup/jobsProzess.ts vor dem Worker aufruft; den ganzen Job-Betrieb
  // hochzufahren startete echte Aufträge, die Verbindungen halten.
  await prozess.reportProcessAn();

  await t.test('der Start übernimmt den Auftrag eines toten Prozesses', async () => {
    assert.notEqual(await status(tot), 'laeuft');
  });
  await t.test('ein lebender Prozess behält seinen Auftrag', async () => {
    assert.equal(await status(anderer), 'laeuft');
  });
  await t.test('die eigenen Belegungen bleiben', async () => {
    assert.equal(await status(eigener), 'laeuft');
  });
});
