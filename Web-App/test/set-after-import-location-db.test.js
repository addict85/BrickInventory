/**
 * A repeated import of the minifigures and parts of a set leaves the existing
 * inventory rows standing — with identifier, storage location and date —, creates new ones and
 * removes only the dropped ones. Before, it deleted all set rows and created
 * them anew; {id:1, storage_id:1} became {id:2, storage_id:null}.
 *
 * Counter-checks (measured on 29.10.2026):
 *   A  in importMinifigs again first `DELETE … source='set'` without
 *      a condition → red: “the minifigure keeps identifier and storage location”
 *   B  the same in importParts → red: “the part keeps identifier, storage location
 *      and date”
 *   C  the targeted DELETE removed in importMinifigs → red: “a
 *      dropped minifigure goes, a typed-in one stays”
 *   D  in merkeSetTeile the merging per part and color removed → red:
 *      “build part and spare part of the same color” (ON CONFLICT DO UPDATE command
 *      cannot affect row a second time) and as a consequence the two parts tests
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

test('repeated set import keeps storage location and identifier', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const { importMinifigs, importParts } = _req('src/sets/setContentImport.js');
  const NAME = `nachimport-${process.pid}`;
  const SN = `8${process.pid % 10000}-1`;
  const INV = 900000000 + (process.pid % 100000);
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  const location = (
    await db.get(`INSERT INTO storage_locations (user_id, name) VALUES ($1, 'Regal') RETURNING id`, [uid])
  ).id;
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2)', [uid, SN]);
  await db.run(`INSERT INTO minifigs_catalog (fig_number, fig_name) VALUES ('fig-t1', 'Eins'), ('fig-t2', 'Zwei')
                ON CONFLICT (fig_number) DO UPDATE SET fig_name = EXCLUDED.fig_name`);
  await db.run(
    `INSERT INTO set_minifigs (set_number, fig_number, quantity)
                VALUES ($1, 'fig-t1', 1), ($1, 'fig-t2', 2)`,
    [SN],
  );
  await db.run(`INSERT INTO minifigs (user_id, set_number, fig_number, source) VALUES ($1, NULL, 'fig-t9', 'manual')`, [
    uid,
  ]);
  await db.run('INSERT INTO rb_inventories (id, set_num, version) VALUES ($1, $2, 1)', [INV, SN]);
  await db.run(
    `INSERT INTO rb_inventory_parts (inventory_id, part_num, color_id, quantity, is_spare)
                VALUES ($1, 'tp-1', 1, 4, false), ($1, 'tp-1', 1, 1, true), ($1, 'tp-2', 5, 2, false)`,
    [INV],
  );

  const minifig = nr => db.get('SELECT id, storage_id FROM minifigs WHERE user_id=$1 AND fig_number=$2', [uid, nr]);
  const part = nr =>
    db.get(`SELECT id, storage_id, added_at::text AS added_at FROM parts WHERE user_id=$1 AND part_number=$2`, [
      uid,
      nr,
    ]);

  try {
    await t.test('the minifigure keeps identifier and storage location', async () => {
      assert.equal(await importMinifigs(SN, uid), 2);
      await db.run('UPDATE minifigs SET storage_id=$1 WHERE user_id=$2 AND fig_number=$3', [location, uid, 'fig-t1']);
      const prior = await minifig('fig-t1');
      assert.equal(prior.storage_id, location);
      assert.equal(await importMinifigs(SN, uid), 2);
      assert.deepEqual(await minifig('fig-t1'), prior);
    });

    await t.test('a dropped minifigure goes, a typed-in one stays', async () => {
      await db.run(`DELETE FROM set_minifigs WHERE set_number=$1 AND fig_number='fig-t2'`, [SN]);
      assert.equal(await importMinifigs(SN, uid), 1);
      assert.equal(await minifig('fig-t2'), undefined);
      assert.ok(await minifig('fig-t1'));
      assert.ok(await minifig('fig-t9'), 'the typed-in figure without a set does not belong to the import');
    });

    await t.test('build part and spare part of the same color', async () => {
      assert.equal(await importParts(SN, uid), 3);
      const list = await db.get(`SELECT quantity, is_spare FROM set_parts WHERE set_number=$1 AND part_number='tp-1'`, [
        SN,
      ]);
      assert.deepEqual(list, { quantity: 4, is_spare: false }, 'the part quantity counts, not the spare parts');
    });

    await t.test('the part keeps identifier, storage location and date', async () => {
      await db.run(
        `UPDATE parts SET storage_id=$1, added_at='2020-01-02T00:00:00Z' WHERE user_id=$2 AND part_number='tp-1'`,
        [location, uid],
      );
      const prior = await part('tp-1');
      assert.equal(prior.storage_id, location);
      await importParts(SN, uid);
      assert.deepEqual(await part('tp-1'), prior);
    });

    await t.test('a dropped part goes', async () => {
      await db.run(`DELETE FROM rb_inventory_parts WHERE inventory_id=$1 AND part_num='tp-2'`, [INV]);
      await importParts(SN, uid);
      assert.equal(await part('tp-2'), undefined);
      assert.ok(await part('tp-1'));
    });
  } finally {
    await db.run('DELETE FROM rb_inventory_parts WHERE inventory_id=$1', [INV]);
    await db.run('DELETE FROM rb_inventories WHERE id=$1', [INV]);
    await db.run('DELETE FROM set_minifigs WHERE set_number=$1', [SN]);
    await db.run('DELETE FROM set_parts WHERE set_number=$1', [SN]);
    await db.run('DELETE FROM users WHERE id=$1', [uid]);
    await db.pool.end().catch(() => {});
  }
});
