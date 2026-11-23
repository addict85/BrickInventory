/**
 * A new entry carries the price in the account currency, and a
 * CSV date lands in exactly the entry the import creates.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  in priceForNewEntry again the global currency (`'EUR'` fixed)
 *      → red: “the quantity increase takes the price in the account currency”
 *      (500 instead of 800)
 *   B  CSV adding (then addSetWithDate) again with a subsequent UPDATE on the highest id
 *      → red: “the CSV date only hits the new entry” (the purchase of
 *      1.10. then stood on 5.5.2020)
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
const { holdsSet } = require('./helpers/inventory');

test('acquisitions: account currency and CSV date', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const NAME = `waehr-datum-${process.pid}`,
    SN = `31160-${process.pid % 1000}`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  await db.run(`INSERT INTO user_settings (user_id,key,value) VALUES ($1,'currency','CHF')`, [uid]);
  await db.run('DELETE FROM price_cache WHERE set_number=$1', [SN]);
  for (const [w, p] of [
    ['EUR', 500],
    ['CHF', 800],
  ])
    await db.run(
      `INSERT INTO price_cache (set_number,condition,currency_code,avg_price,qty_avg_price,total_quantity)
                  VALUES ($1,'N',$2,$3,$3,3)`,
      [SN, w, p],
    );
  const { changeSet, acquireSet } = require('./helpers/sources').areaPage('sets');

  try {
    await t.test('the quantity increase takes the price in the account currency', async () => {
      await holdsSet(db, uid, SN, 1, { preis: 700, am: '2026-09-01T10:00:00Z' });
      await changeSet(uid, SN, { quantity: 2 });
      const neu = await db.get(
        `SELECT purchase_price, currency, price_estimated FROM set_acquisitions
          WHERE user_id=$1 AND set_number=$2 ORDER BY id DESC LIMIT 1`,
        [uid, SN],
      );
      assert.equal(Number(neu.purchase_price), 800);
      assert.equal(neu.currency, 'CHF');
      assert.equal(neu.price_estimated, true);
    });

    await t.test('the CSV date only affects the new acquisition', async () => {
      await db.run('DELETE FROM set_acquisitions WHERE user_id=$1 AND set_number=$2', [uid, SN]);
      await db.run(
        `INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition,created_at)
                    VALUES ($1,$2,1,100,'N',NOW()), ($1,$2,1,50,'N','2026-10-01T12:00:00Z')`,
        [uid, SN],
      );
      await acquireSet({
        requester: uid,
        setNumber: SN,
        quantity: 1,
        purchasePrice: 100,
        condition: 'N',
        recordedAt: '2020-05-05',
        ifPresent: 'aufstocken',
      });
      const zeilen = await db.all(
        `SELECT quantity, purchase_price::float AS preis, (created_at AT TIME ZONE 'UTC')::date::text AS tag
           FROM set_acquisitions WHERE user_id=$1 AND set_number=$2 ORDER BY tag`,
        [uid, SN],
      );
      const todayDate = new Date().toISOString().slice(0, 10);
      assert.deepEqual(zeilen, [
        { quantity: 1, preis: 100, tag: '2020-05-05' },
        { quantity: 1, preis: 50, tag: '2026-10-01' },
        { quantity: 1, preis: 100, tag: todayDate },
      ]);
    });
  } finally {
    await db.run('DELETE FROM users WHERE id=$1', [uid]);
    await db.run('DELETE FROM price_cache WHERE set_number=$1', [SN]);
    await db.pool.end().catch(() => {});
  }
});
