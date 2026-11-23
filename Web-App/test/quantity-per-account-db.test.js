/**
 * Quantity in the household per account: a reduction only takes away purchases of the named
 * account, says which purchase was dropped, and puts it into the trash, from
 * which it comes back row by row (even a merely shortened purchase).
 *
 * Counter-checks (measured 12./13.11.2026, each on its own, dist rebuilt):
 *   A  in changeSet `ziel` again fixed to `uid` → red: “main account reduces
 *      the sub-account” (sub-account still has 1, the own one 0)
 *   B  putPurchasesInTrash() not called in changeSet → red: “older
 *      purchase stays, newer one comes back” (no papierkorb in the response)
 *   C  in restorePurchases the topping up of the origin row
 *      skipped → red: “shortened purchase” (without the changed price
 *      it stayed green: the search for the same purchase found the row)
 *   E  the topping up of an identical row of the same day skipped →
 *      red: “the same purchase … on the same day”
 *   D  the write scope check (`_wids.includes(ziel)`) removed → red:
 *      “sub-account may not change the main account”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { accessOrSkip } = require('./helpers/db');
const { holdsSet, record, quantityOf } = require('./helpers/inventory');

const purchaseList = (db, uid, sn) =>
  db
    .all(`SELECT to_jsonb(t) AS z FROM set_acquisitions t WHERE user_id=$1 AND set_number=$2 ORDER BY id`, [uid, sn])
    .then(r => r.map(x => x.z));

test('quantity per account with a way back', { concurrency: 1 }, async t => {
  const db = await accessOrSkip(t, _req);
  if (!db) return;
  const NAME = `mjk-${process.pid}`,
    SN = `31171-${process.pid % 1000}`;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, `${NAME}_kind`]]);
  const fresh = n => db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [n]);
  const uid = (await fresh(NAME)).id;
  const kid = (await fresh(`${NAME}_kind`)).id;
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [uid, kid]);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, kid]]);
    await db.pool.end().catch(() => {});
  });
  const { changeSet } = require('./helpers/sources').areaPage('sets');
  const pk = _req('src/inventory/trash.js');

  await t.test('main account reduces the sub-account, undo brings the purchase back', async () => {
    await holdsSet(db, uid, SN, 1, { price: 199.99, am: '2026-06-01T10:00:00Z' });
    await holdsSet(db, kid, SN, 1, { price: 210, am: '2026-06-02T10:00:00Z' });
    const prior = await purchaseList(db, kid, SN);
    const r = await changeSet(uid, SN, { quantity_delta: -1, owner_user_id: kid });
    assert.equal(await quantityOf(db, [kid], SN), 0);
    assert.equal(await quantityOf(db, [uid], SN), 1, 'the own copy did not stay');
    assert.equal(r.quantity, 1);
    assert.deepEqual(
      r.dropped.map(e => [e.quantity, e.purchase_price, e.date]),
      [[1, 210, '2026-06-02']],
    );
    assert.ok(r.trash, 'no trash entry');
    assert.equal((await pk.restore({ writer: uid }, r.trash)).type, 'set');
    assert.deepEqual(await purchaseList(db, kid, SN), prior);
  });

  await t.test('older purchase stays, newer one comes back', async () => {
    await record(db, uid, SN, 1, { price: 250, am: '2026-09-13T10:00:00Z' });
    const prior = await purchaseList(db, uid, SN);
    const r = await changeSet(uid, SN, { quantity_delta: -1 });
    assert.deepEqual(
      r.dropped.map(e => [e.purchase_price, e.date]),
      [[250, '2026-09-13']],
    );
    assert.deepEqual(
      (await purchaseList(db, uid, SN)).map(z => Number(z.purchase_price)),
      [199.99],
    );
    assert.ok(r.trash, 'no trash entry');
    assert.equal((await pk.listTrash([uid])).find(e => e.id === r.trash)?.count, 1);
    assert.equal((await pk.restore({ writer: uid }, r.trash)).type, 'set');
    assert.deepEqual(await purchaseList(db, uid, SN), prior);
  });

  await t.test('shortened purchase: the same row grows again, even with a price changed in the meantime', async () => {
    await record(db, uid, SN, 3, { price: 80, am: '2026-10-01T10:00:00Z' });
    const prior = await purchaseList(db, uid, SN);
    const r = await changeSet(uid, SN, { quantity_delta: -1 });
    assert.deepEqual(
      r.dropped.map(e => [e.quantity, e.purchase_price]),
      [[1, 80]],
    );
    // With a changed price the search for an identical purchase no longer finds the row.
    const id = r.dropped[0].id;
    await db.run('UPDATE set_acquisitions SET purchase_price = 85 WHERE id = $1', [id]);
    assert.equal((await pk.restore({ writer: uid }, r.trash)).type, 'set');
    assert.deepEqual(
      await purchaseList(db, uid, SN),
      prior.map(z => (z.id === id ? { ...z, purchase_price: 85 } : z)),
    );
  });

  await t.test('the same purchase re-entered on the same day: the new row takes the quantity', async () => {
    await record(db, uid, SN, 1, { price: 60, am: '2026-10-05T10:00:00Z' });
    const r = await changeSet(uid, SN, { quantity_delta: -1 });
    await record(db, uid, SN, 1, { price: 60, am: '2026-10-05T12:00:00Z' });
    assert.equal((await pk.restore({ writer: uid }, r.trash)).type, 'set');
    const am5 = (await purchaseList(db, uid, SN)).filter(z => Number(z.purchase_price) === 60);
    assert.deepEqual(
      am5.map(z => z.quantity),
      [2],
    );
    await changeSet(uid, SN, { quantity_delta: -2 });
  });

  await t.test('sub-account may not change the main account', async () => {
    const prior = await quantityOf(db, [uid], SN);
    await assert.rejects(changeSet(kid, SN, { quantity_delta: -1, owner_user_id: uid }), {
      kind: 'forbidden',
    });
    assert.equal(await quantityOf(db, [uid], SN), prior);
  });

  await t.test('part entry without a set: nothing written, entry stays', async () => {
    const r = await changeSet(uid, SN, { quantity_delta: -1 });
    await db.run('DELETE FROM set_acquisitions WHERE user_id=$1 AND set_number=$2', [uid, SN]);
    await db.run('DELETE FROM sets WHERE user_id=$1 AND set_number=$2', [uid, SN]);
    await assert.rejects(pk.restore({ writer: uid }, r.trash), { code: 'not_found' });
    assert.ok((await pk.listTrash([uid])).some(e => e.id === r.trash));
  });
});
