/**
 * Quantity changes from two devices at the same time do not get lost: a
 * relative step (quantity_delta) counts, and the quantity is only read inside the
 * lock.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  in changeSet the target quantity taken from the view beforehand instead of inside the lock
 *      → red: “two concurrent +1 result in +2” (3 instead of 4)
 *   B  quantity_delta ignored (as before the change) → red: all three cases
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { holdsSet, quantityOf } = require('./helpers/inventory');

test('quantity change without lost additions', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const NAME = `delta-${process.pid}`,
    SN = `31170-${process.pid % 1000}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [NAME])).id;
  // A market price in the cache: the addition needs it, and that way nobody asks BrickLink.
  await db.run('DELETE FROM price_cache WHERE set_number = $1', [SN]);
  await db.run(
    `INSERT INTO price_cache (set_number, condition, currency_code, avg_price, qty_avg_price, total_quantity)
                VALUES ($1, 'N', 'EUR', 50, 50, 3)`,
    [SN],
  );
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.run('DELETE FROM price_cache WHERE set_number = $1', [SN]);
    await db.pool.end().catch(() => {});
  });
  const { changeSet } = require('./helpers/sources').areaPage('sets');

  await t.test('two concurrent +1 result in +2', async () => {
    await holdsSet(db, uid, SN, 2, { preis: 40 });
    await Promise.all([changeSet(uid, SN, { quantity_delta: 1 }), changeSet(uid, SN, { quantity_delta: 1 })]);
    assert.equal(await quantityOf(db, [uid], SN), 4);
  });

  await t.test('a step down takes away exactly one', async () => {
    const r = await changeSet(uid, SN, { quantity_delta: -1 });
    assert.equal(r.quantity, 3);
  });

  await t.test('an invalid step is rejected', async () => {
    await assert.rejects(changeSet(uid, SN, { quantity_delta: 1.5 }), (/** @type {any} */ e) => e.kind === 'invalid');
  });
});
