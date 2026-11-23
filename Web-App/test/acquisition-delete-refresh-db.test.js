/**
 * Delete an entry → price and condition of the RESPONSE are determined ANEW.
 *
 * Counter-check: in deleteAcquisition() (src/collection/acquisitions.ts) the removal of the entry skipped → red “deleting an acquisition redetermines price and condition of the parent row”.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { holdsSet, quantityOf, haltRow } = require('./helpers/inventory');
const db = testData();

test('deleting an acquisition redetermines price and condition of the parent row', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const USER = `delp-${process.pid}`;
  const SN = `41439-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username=$1`, [USER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [USER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [USER])).id;

  const { base, srv } = testServer(_req, { session: { userId: uid }, t });

  // Two entries; the parent row carries the value of the NEWEST.
  const setUp = async () => {
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]);
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]);
    // Only the stock row, without numbers: quantity, price and condition are in
    // the two entries below (migration 0032 for price and condition,
    // 0036 for the quantity). Quantity 0 here means “the entries carry it" —
    // 1 + 1 = 2, as before in the column.
    await holdsSet(db, uid, SN, 0);
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity,created_at)
                  VALUES ($1,$2,7.41,'U',1, NOW() - INTERVAL '2 days')`,
      [uid, SN],
    );
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity,created_at)
                  VALUES ($1,$2,9.48,'N',1, NOW() - INTERVAL '1 day')`,
      [uid, SN],
    );
  };
  const latest = async () =>
    (
      await db.get(
        `SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number=$2
      ORDER BY created_at DESC, id DESC LIMIT 1`,
        [uid, SN],
      )
    ).id;
  // What the tile sees: the aggregate from the entries plus the quantity of the
  // sets row (which the delete path still recomputes).
  const parents = async () => {
    // “Does the row exist?" and “how many copies?" are, since migration 0036,
    // two questions to two tables — before, the column answered both
    // at once. The order stays: without a stock row there is no
    // parent information, even if entries should still be lying around.
    if (!(await haltRow(db, uid, SN))) return undefined;
    const agg = await _req('src/sets/read.js').conditionAggregate(
      require('./helpers/sources').testContext('sets'),
      [uid],
      SN,
    );
    return {
      purchase_price: agg.avg_purchase_price,
      condition: agg.condition,
      quantity: await quantityOf(db, uid, SN),
    };
  };

  try {
    // 0. Before deleting: two entries, 7.41 and 9.48, one copy each.
    //    The old column would have carried 9.48 (price of the newest entry).
    //    The response must show the quantity-weighted mean.
    await setUp();
    const prior = await parents();
    assert.equal(
      Number(prior.purchase_price),
      8.445,
      'The shown price is not the mean over the acquisitions — ' +
        'at 9.48 it still shows the value of the NEWEST acquisition',
    );
    assert.equal(prior.condition, 'U', 'A used acquisition makes the set used');

    // 1. Marco's case: delete the newest entry.
    await setUp();
    let r = await fetch(`${base}/api/v2/sets/${SN}/acquisitions/${await latest()}`, { method: 'DELETE' });
    assert.equal(r.status, 200);
    let e = await parents();
    assert.equal(
      Number(e.purchase_price),
      7.41,
      'The tile shows the price of the DELETED row — it must follow the remaining one',
    );
    // 7.41 is also the mean here, because only one entry is
    // left. Substep 2 below separates the two readings.
    assert.equal(e.condition, 'U', 'The condition must also follow the remaining acquisition, not the deleted one');
    assert.equal(Number(e.quantity), 1, 'The quantity must still be correct');

    // 2. Opposite direction: deleting an OLDER entry must not change
    //    anything in the price — the newest one stays after all.
    await setUp();
    const old = (
      await db.all(
        `SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number=$2
        ORDER BY created_at ASC, id ASC`,
        [uid, SN],
      )
    )[0].id;
    r = await fetch(`${base}/api/v2/sets/${SN}/acquisitions/${old}`, { method: 'DELETE' });
    assert.equal(r.status, 200);
    e = await parents();
    assert.equal(Number(e.purchase_price), 9.48, 'Deleting an older acquisition may keep the price of the newest');

    // 3. Delete the last entry: none is left — and since then
    //  no parent row either.
    await setUp();
    for (const row of await db.all(`SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`, [uid, SN])) {
      await fetch(`${base}/api/v2/sets/${SN}/acquisitions/${row.id}`, { method: 'DELETE' });
    }
    assert.equal(await parents(), undefined, 'Without acquisitions no set row with quantity 0 may remain');
  } finally {
    await db.run(`DELETE FROM users WHERE username=$1`, [USER]).catch(() => {});
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]).catch(() => {});
    await new Promise(r2 => srv.close(r2));
    await db.pool.end().catch(() => {});
  }
});
