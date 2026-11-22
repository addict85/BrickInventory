/**
 * A broken quantity deletes no inventory, and quantity 0 goes into the
 * trash.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  inventoryQuantity() in changeSet replaced by `parseInt(body.quantity) || 0`
 *      → red: “a broken quantity is rejected” (200, set gone)
 *   B  putInTrash() removed in the branch for quantity 0 → red: “quantity 0
 *      puts the set into the trash”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();
const { holdsSet, quantityOf } = require('./helpers/inventory');

test('quantity change on the set: validation and trash', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const NAME = `menge-pruef-${process.pid}`,
    SN = `31150-${process.pid % 1000}`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  await holdsSet(db, uid, SN, 2, { preis: 40 });

  const { base } = testServer(_req, { sitzung: { userId: uid }, t });
  const put = quantity =>
    fetch(`${base}/api/v2/sets/${SN}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: quantity }),
    });

  try {
    await t.test('a broken quantity is rejected', async () => {
      for (const kaputt of [{ a: 1 }, 'abc', -1, 1.5]) {
        const r = await put(kaputt);
        assert.equal(r.status, 400, JSON.stringify(kaputt));
      }
      assert.equal(await quantityOf(db, uid, SN), 2, 'the stock is unchanged');
    });

    await t.test('a valid quantity as text is accepted', async () => {
      const r = await put('3');
      assert.equal(r.status, 200);
      assert.equal(await quantityOf(db, uid, SN), 3);
    });

    await t.test('quantity 0 puts the set into the trash', async () => {
      const r = await put(0);
      assert.equal(r.status, 200);
      const j = await r.json();
      assert.equal(j.quantity, 0);
      assert.ok(j.trash, 'the response names the trash entry');
      const entryRow = await db.get('SELECT type, number FROM trash WHERE id=$1 AND user_id=$2', [j.trash, uid]);
      assert.equal(entryRow?.number, SN);
      assert.equal(await db.get('SELECT 1 FROM sets WHERE user_id=$1 AND set_number=$2', [uid, SN]), undefined);
    });
  } finally {
    await db.run('DELETE FROM users WHERE id=$1', [uid]);
    await db.pool.end().catch(() => {});
  }
});
