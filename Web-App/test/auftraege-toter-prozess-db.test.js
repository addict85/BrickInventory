/**
 * Ein Job-Prozess, der hart endet, gibt seine laufenden Aufträge nicht zurück.
 * Der nächste Start übernimmt sie sofort, nicht erst nach der Frist; Aufträge
 * eines lebenden Prozesses und die eigenen bleiben, wo sie sind.
 *
 * Gegenproben (06.11.2026):
 *   A  in gibVerwaisteZurueck() die Abfrage pg_try_advisory_lock durch `true`
 *      ersetzt → rot: „ein lebender Prozess behält seinen Auftrag“
 *   B  in startup/jobsProzess.ts den Aufruf meldeProzessAn() gestrichen → rot:
 *      „der Start übernimmt den Auftrag eines toten Prozesses“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');

test('Aufträge toter Job-Prozesse', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;
  const prozess = _req('src/auftraege/prozess.js');
  const { LOCKS } = _req('src/infra/lockNamespaces.js');
  const lebend = await db.pool.connect();
  t.after(async () => {
    prozess.meldeProzessAb();
    lebend.release(true);
    await _req('db/pgNotify.js')
      .close()
      .catch(() => {});
    await db.pool.end().catch(() => {});
  });
  await lebend.query('SELECT pg_advisory_lock($1, hashtext($2))', [LOCKS.JOB_PROZESS, 'lebender-prozess']);

  const laufend = async belegtVon =>
    (
      await db.get(
        `INSERT INTO auftraege (art, nutzlast, status, belegt_von, frist_bis, gestartet, versuche)
     VALUES ('aufraeumen', '{}', 'laeuft', $1, NOW() + interval '5 minutes', NOW(), 1) RETURNING id`,
        [belegtVon],
      )
    ).id;
  const tot = await laufend('toter-prozess/1');
  const anderer = await laufend('lebender-prozess/2');
  const eigener = await laufend(`${prozess.PROZESS}/3`);
  const status = async id => (await db.get('SELECT status FROM auftraege WHERE id = $1', [id])).status;

  // Wie beim Start: startup/jobsProzess.ts ruft meldeProzessAn() vor dem Worker.
  const { starteJobs, stoppeJobs } = _req('startup/jobsProzess.js');
  await starteJobs(true);
  await stoppeJobs();

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
