/**
 * The parts summary becomes outdated when a copied text changes:
 * the name of a storage location or a catalog entry.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  the trigger on storage_locations left out in 0052 → red: “a
 *      renamed storage location invalidates the summary”
 *   B  in summaryFresh the comparison of the catalog state removed → red: “a
 *      changed part name invalidates it as well” (since migration 0079: “a
 *      changed part name is updated immediately”, see
 *      parts-catalog-incremental-db.test.js)
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
const { holdsSet, holdsPart } = require('./helpers/inventory');

test('parts summary: state', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const PS = _req('src/parts/summary.js');
  const NAME = `stand-${process.pid}`,
    SN = `31170-${process.pid % 1000}`,
    TEIL = `stand${process.pid}`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  const location = (
    await db.get(`INSERT INTO storage_locations (user_id, name) VALUES ($1, 'Kiste 1') RETURNING id`, [uid])
  ).id;
  await holdsSet(db, uid, SN, 1);
  await holdsPart(db, uid, TEIL, { setNumber: SN, quantity: 2, colorId: 4, storageId: location });
  await db.run(
    `INSERT INTO part_catalog (part_number, part_name) VALUES ($1, 'Alter Name')
                ON CONFLICT (part_number) DO UPDATE SET part_name = 'Alter Name'`,
    [TEIL],
  );

  try {
    await t.test('a renamed storage location invalidates the summary', async () => {
      await PS.rebuildNow(uid);
      assert.equal(await PS.summaryFresh(uid, { strict: true }), true, 'precondition: fresh');
      await db.run(`UPDATE storage_locations SET name = 'Regal B' WHERE id = $1`, [location]);
      assert.equal(await PS.summaryFresh(uid, { strict: true }), false);
      await PS.rebuildNow(uid);
      const z = await db.get('SELECT storage FROM parts_summary WHERE user_id=$1', [uid]);
      assert.equal(z.storage, 'Regal B');
    });

    await t.test('a changed part name is updated immediately', async () => {
      await PS.rebuildNow(uid);
      assert.equal(await PS.summaryFresh(uid, { strict: true }), true, 'precondition: fresh');
      await db.run(`UPDATE part_catalog SET part_name = 'Neuer Name' WHERE part_number = $1`, [TEIL]);
      assert.equal(await PS.summaryFresh(uid, { strict: true }), true, 'the catch-up runs in summaryFresh');
      assert.equal(
        (await db.get('SELECT part_name FROM parts_summary WHERE user_id=$1', [uid])).part_name,
        'Neuer Name',
      );
    });
  } finally {
    await db.run('DELETE FROM users WHERE id=$1', [uid]);
    await db.run('DELETE FROM part_catalog WHERE part_number=$1', [TEIL]);
    await db.pool.end().catch(() => {});
  }
});
