/**
 * Der Tag einer Erfassung gilt in der Zeitzone der Installation. Mit dem
 * UTC-Tag fiel ein Kauf um 00:30 in Zürich (23:30 UTC am Vortag) auf den
 * Vortag und wurde mit einem Kauf vom Vorabend zusammengelegt, aber nicht mit
 * einem vom selben Morgen (Migration 0070, ERFASSUNG_ZEITZONE).
 *
 * Gegenproben (am 29.10.2026 gemessen, je auf frischer Datenbank):
 *   A  der Trigger erfassung_tag() rechnet wieder in 'UTC' → rot: „ein Kauf
 *      um 00:30 gehört zum selben Tag wie einer am Mittag“
 *   B  im Trigger der Zweig für UPDATE entfernt → rot: „ein geändertes
 *      Datum ist der neue Tag“ (der Tag blieb beim alten)
 * Seit Migration 0078 steht die Zone in der Datenbank (30.10.2026 gemessen):
 *   C  der Trigger liest wieder current_setting('brickinventory.zeitzone')
 *      → rot: alle drei Teilprüfungen, auch „eine Verbindung ausserhalb des
 *      Pools rechnet denselben Tag“ (2026-03-09 statt 2026-03-10)
 *   D  schreibeErfassungsZeitzone() in initSchemaOnce() ausgelassen → rot:
 *      alle drei (es gilt UTC)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.ERFASSUNG_ZEITZONE = 'Europe/Zurich';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

test('Erfassungstag in der Zeitzone der Installation', { concurrency: 1 }, async (t) => {
  // initSchemaOnce wie beim Start: Schema, Migrationen, Zone in die Datenbank.
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const { recordAcquisitionForDay } = _req('src/bestand/acquisitions.js');
  const NAME = `tagzone-${process.pid}`;
  const SN = `TZ${process.pid}-1`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2)', [uid, SN]);
  const kauf = (am) => recordAcquisitionForDay('set', uid, [SN], { quantity: 1, price: 10, condition: 'N', currency: 'CHF', createdAt: am });
  const zeilen = () => db.all(`SELECT tag::text AS tag, quantity FROM set_acquisitions WHERE user_id=$1 ORDER BY tag`, [uid]);

  try {
    await t.test('ein Kauf um 00:30 gehört zum selben Tag wie einer am Mittag', async () => {
      assert.equal((await kauf('2026-03-04T23:30:00Z')).merged, false);   // 05.03. 00:30 in Zürich
      assert.equal((await kauf('2026-03-05T11:00:00Z')).merged, true);    // 05.03. 12:00
      assert.equal((await kauf('2026-03-04T21:30:00Z')).merged, false);   // 04.03. 22:30
      assert.deepEqual(await zeilen(), [{ tag: '2026-03-04', quantity: 1 }, { tag: '2026-03-05', quantity: 2 }]);
    });
    await t.test('eine Verbindung ausserhalb des Pools rechnet denselben Tag', async () => {
      // So schreibt psql oder ein Skript: ohne Sitzungseinstellungen des Pools.
      const c = await db.eigeneVerbindung();
      try {
        const r = await c.query(`INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency, created_at)
                                 VALUES ($1, $2, 1, 11, 'U', 'CHF', '2026-03-09T23:30:00Z') RETURNING tag::text AS tag`, [uid, SN]);
        assert.equal(r.rows[0].tag, '2026-03-10');
      } finally { await c.end(); }
    });
    await t.test('ein geändertes Datum ist der neue Tag', async () => {
      const id = (await db.get(`SELECT id FROM set_acquisitions WHERE user_id=$1 AND tag='2026-03-04'`, [uid])).id;
      await db.run(`UPDATE set_acquisitions SET created_at = '2026-02-01T23:30:00Z' WHERE id=$1`, [id]);
      assert.equal((await db.get('SELECT tag::text AS tag FROM set_acquisitions WHERE id=$1', [id])).tag, '2026-02-02',
        'der Trigger rechnet den Tag neu, in Zürich');
    });
  } finally {
    await db.run('DELETE FROM users WHERE id=$1', [uid]);
    // Die Zone gilt für die ganze Datenbank; nachfolgende Tests rechnen in UTC.
    await db.run(`UPDATE global_settings SET value = 'UTC' WHERE key = 'erfassung_zeitzone'`);
    await db.pool.end().catch(() => {});
  }
});
