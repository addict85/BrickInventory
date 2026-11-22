/**
 * The day of an entry applies in the installation's time zone. With the
 * UTC day a purchase at 00:30 in Zurich (23:30 UTC on the previous day) fell on the
 * previous day and was merged with a purchase from the previous evening, but not with
 * one from the same morning (migration 0070, ACQUISITION_TIME_ZONE).
 *
 * Counter-checks (measured on 29.10.2026, each on a fresh database):
 *   A  the trigger erfassung_tag() computes in 'UTC' again → red: “a purchase
 *      at 00:30 belongs to the same day as one at noon”
 *   B  the branch for UPDATE removed in the trigger → red: “a changed
 *      date is the new day” (the day stayed the old one)
 * Since migration 0078 the zone is in the database (measured 30.10.2026):
 *   C  the trigger reads current_setting('brickinventory.zeitzone') again
 *      → red: all three subchecks, also “a connection outside the
 *      pool computes the same day” (2026-03-09 instead of 2026-03-10)
 *   D  writeEntryTimeZone() skipped in initSchemaOnce() → red:
 *      all three (UTC applies)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.ACQUISITION_TIME_ZONE = 'Europe/Zurich';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testData();

test('acquisition day in the time zone of the installation', { concurrency: 1 }, async t => {
  // initSchemaOnce as at startup: schema, migrations, zone into the database.
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  const { addPurchaseAtTag } = _req('src/inventory/acquisitions.js');
  const NAME = `tagzone-${process.pid}`;
  const SN = `TZ${process.pid}-1`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2)', [uid, SN]);
  const kauf = am =>
    addPurchaseAtTag('set', uid, [SN], {
      quantity: 1,
      price: 10,
      condition: 'N',
      currency: 'CHF',
      createdAt: am,
    });
  const zeilen = () =>
    db.all(`SELECT day::text AS tag, quantity FROM set_acquisitions WHERE user_id=$1 ORDER BY day`, [uid]);

  try {
    await t.test('a purchase at 00:30 belongs to the same day as one at noon', async () => {
      assert.equal((await kauf('2026-03-04T23:30:00Z')).merged, false); // 05.03. 00:30 in Zurich
      assert.equal((await kauf('2026-03-05T11:00:00Z')).merged, true); // 05.03. 12:00
      assert.equal((await kauf('2026-03-04T21:30:00Z')).merged, false); // 04.03. 22:30
      assert.deepEqual(await zeilen(), [
        { tag: '2026-03-04', quantity: 1 },
        { tag: '2026-03-05', quantity: 2 },
      ]);
    });
    await t.test('a connection outside the pool computes the same day', async () => {
      // This is how psql or a script writes: without the pool's session settings.
      const c = await db.ownConnection();
      try {
        const r = await c.query(
          `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency, created_at)
                                 VALUES ($1, $2, 1, 11, 'U', 'CHF', '2026-03-09T23:30:00Z') RETURNING day::text AS tag`,
          [uid, SN],
        );
        assert.equal(r.rows[0].tag, '2026-03-10');
      } finally {
        await c.end();
      }
    });
    await t.test('a changed date is the new day', async () => {
      const id = (await db.get(`SELECT id FROM set_acquisitions WHERE user_id=$1 AND day='2026-03-04'`, [uid])).id;
      await db.run(`UPDATE set_acquisitions SET created_at = '2026-02-01T23:30:00Z' WHERE id=$1`, [id]);
      assert.equal(
        (await db.get('SELECT day::text AS tag FROM set_acquisitions WHERE id=$1', [id])).tag,
        '2026-02-02',
        'der Trigger rechnet den Tag neu, in Zürich',
      );
    });
  } finally {
    await db.run('DELETE FROM users WHERE id=$1', [uid]);
    // The zone applies to the whole database; subsequent tests compute in UTC.
    await db.run(`UPDATE global_settings SET value = 'UTC' WHERE key = 'erfassung_zeitzone'`);
    await db.pool.end().catch(() => {});
  }
});
