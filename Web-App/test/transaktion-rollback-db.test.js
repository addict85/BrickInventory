/**
 * transaction(): Scheitert das ROLLBACK, kommt der ursprüngliche Fehler an,
 * und die kaputte Verbindung geht nicht zurück in den Pool.
 *
 * Gegenproben (am 27.10. gemessen):
 *   A  wieder `await client.query('ROLLBACK')` ohne eigenes try und
 *      `client.release()` ohne Fehler → rot: „der Fehler aus fn kommt an,
 *      nicht der vom ROLLBACK"
 *   B  `client.on('error', abriss)` entfernt → rot: das 'error'-Ereignis des
 *      Clients bleibt ohne Zuhörer und bricht den Lauf ab („danach arbeitet
 *      der Pool weiter" wird abgebrochen)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

test('transaction() bei kaputter Verbindung', async (t) => {
  try { await db.get('SELECT 1'); }
  catch (e) {
    await db.pool.end().catch(() => {});
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  t.after(() => db.pool.end().catch(() => {}));

  await t.test('der Fehler aus fn kommt an, nicht der vom ROLLBACK', async () => {
    await assert.rejects(db.transaction(async (tx) => {
      // Die eigene Verbindung beenden: Danach scheitert jedes ROLLBACK.
      await tx.get('SELECT pg_terminate_backend(pg_backend_pid())').catch(() => {});
      throw new Error('Ursprung');
    }), (e) => e.message === 'Ursprung');
  });

  await t.test('danach arbeitet der Pool weiter', async () => {
    for (let i = 0; i < 12; i++) assert.equal((await db.get('SELECT 1 AS n')).n, 1);
  });
});
