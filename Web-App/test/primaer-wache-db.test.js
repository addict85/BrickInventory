/**
 * primaerFehlt(): erkennt, ob in dieser Datenbank jemand die Primär-Sperre
 * hält. Sekundär-Worker starten neu, wenn sie zweimal fehlt (server.ts).
 *
 * Gegenprobe (am 27.10. gemessen): objsubid = 2 statt 1 in der Abfrage → rot:
 * „wer die Sperre hält, wird gesehen".
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { primaerFehlt } = _req('utils/primaerWache.js');
const { LOCKS } = _req('utils/lockNamespaces.js');

test('Primär-Wache', { concurrency: 1 }, async (t) => {
  try { await db.get('SELECT 1'); }
  catch (e) {
    await db.pool.end().catch(() => {});
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  t.after(() => db.pool.end().catch(() => {}));

  await t.test('ohne Halter fehlt der Primär', async () => {
    assert.equal(await primaerFehlt(db), true);
  });

  await t.test('wer die Sperre hält, wird gesehen', async () => {
    const c = await db.pool.connect();
    try {
      assert.equal((await c.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCKS.PRIMARY_WORKER])).rows[0].ok, true);
      assert.equal(await primaerFehlt(db), false);
    } finally {
      await c.query('SELECT pg_advisory_unlock($1)', [LOCKS.PRIMARY_WORKER]).catch(() => {});
      c.release();
    }
    assert.equal(await primaerFehlt(db), true, 'nach dem Freigeben fehlt er wieder');
  });
});
