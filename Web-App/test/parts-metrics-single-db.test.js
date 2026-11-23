/**
 * The metrics „Sorten“ and „Farben“ above the parts list also count the
 * individually captured parts — on both paths (live query and summary).
 * Before, an account with four individual parts in four colors showed „0 / 0“.
 *
 * Counter-checks (measured on 03.11.2026):
 *   A  in kennzahlen() (live) again `AND COALESCE(p.source,'set') <> 'manual'`
 *      in the WHERE clause → red: all three, “only individual parts: 4 kinds
 *      in 4 colors” with 0 instead of 4
 *   B  in the summary branch the UNION part with the individual parts
 *      removed → red only: “mixed: summary and live the same”
 *   C  in the live query the FILTER on total_parts removed → red: all
 *      three, first total_parts 100 instead of 0 (individual parts counted twice)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const { holdsSet, holdsPart } = require('./helpers/inventory');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();

test('parts metrics with individually captured parts', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const H = require('./helpers/sources').handlerModule(_req);
  const PS = _req('src/parts/summary.js');
  const A = `kz-einzeln-${process.pid}`,
    B = `kz-gemischt-${process.pid}`;
  const SN = `KE${process.pid}-1`;
  const PARTS = ['ke1', 'ke2', 'ke3', 'ke4'];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[A, B]]);
  const UA = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [A])).id;
  const UB = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [B])).id;
  for (const nr of PARTS)
    await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES ($1, $1) ON CONFLICT DO NOTHING`, [nr]);
  try {
    // Account A: only individual parts, four kinds in four colors.
    for (const [i, nr] of PARTS.entries()) await holdsPart(db, UA, nr, { colorId: [1, 4, 15, 0][i], quantity: 25 });
    // Account B: a set with ke1/color 1 (×3) and ke2/color 4 (×2), plus individually
    // ke1/color 1 (the same kind) and ke3/color 15 (new kind and color).
    await holdsSet(db, UB, SN, 1);
    await holdsPart(db, UB, 'ke1', { setNumber: SN, colorId: 1, quantity: 3 });
    await holdsPart(db, UB, 'ke2', { setNumber: SN, colorId: 4, quantity: 2 });
    await holdsPart(db, UB, 'ke1', { colorId: 1, quantity: 7 });
    await holdsPart(db, UB, 'ke3', { colorId: 15, quantity: 1 });

    await t.test('only individual parts: 4 kinds in 4 colors', async () => {
      const s = await H.partStatsQuery(UA);
      assert.equal(s.unique_parts, 4);
      assert.equal(s.unique_colors, 4);
      assert.equal(s.total_parts, 0, 'no set parts');
      assert.equal(s.manual_parts, 100);
    });
    await t.test('the total does not count individual parts twice', async () => {
      const s = await H.partStatsQuery(UB);
      assert.equal(s.total_parts, 5, 'Set-Teile 3 + 2');
      assert.equal(s.manual_parts, 8, 'individually 7 + 1');
      assert.equal(s.unique_parts, 3);
      assert.equal(s.unique_colors, 3);
    });
    await t.test('mixed: summary and live the same', async () => {
      const live = await H.partStatsQuery(UB);
      await PS.rebuildNow(UB);
      const repo = {
        ..._req('src/parts/repository/partsList.js'),
        ...require('./helpers/sources').testArea('parts').partsList,
      };
      const zsf = await repo.stats([UB], true);
      assert.deepEqual(zsf, live);
      assert.deepEqual(await H.partStatsQuery(UB), live);
    });
  } finally {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[UA, UB]]);
    await db.run('DELETE FROM set_parts WHERE set_number=$1', [SN]);
    await db.run('DELETE FROM part_catalog WHERE part_number = ANY($1)', [PARTS]);
    await db.pool.end().catch(() => {});
  }
});
