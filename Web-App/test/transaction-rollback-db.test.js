/**
 * transaction(): Scheitert das ROLLBACK, kommt der ursprüngliche Fehler an,
 * und die kaputte Verbindung geht nicht zurück in den Pool.
 *
 * Gegenproben (am 27.10. gemessen):
 *   A  wieder `await client.query('ROLLBACK')` ohne eigenes try und
 *      `client.release()` ohne Fehler → rot: „der Fehler aus fn kommt an,
 *      nicht der vom ROLLBACK"
 *   B  `client.on('error', teardown)` entfernt → rot: das 'error'-Ereignis des
 *      Clients bleibt ohne Zuhörer und bricht den Lauf ab („danach arbeitet
 *      der Pool weiter" wird abgebrochen)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testData();

test('transaction() with a broken connection', async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    await db.pool.end().catch(() => {});
    keineDb(t, e);
    return;
  }
  t.after(() => db.pool.end().catch(() => {}));

  await t.test('the error from fn arrives, not the one from ROLLBACK', async () => {
    await assert.rejects(
      db.transaction(async tx => {
        // Die eigene Verbindung beenden: Danach scheitert jedes ROLLBACK.
        await tx.get('SELECT pg_terminate_backend(pg_backend_pid())').catch(() => {});
        throw new Error('Ursprung');
      }),
      (/** @type {any} */ e) => e.message === 'Ursprung',
    );
  });

  await t.test('afterwards the pool keeps working', async () => {
    for (let i = 0; i < 12; i++) assert.equal((await db.get('SELECT 1 AS n')).n, 1);
  });
});
