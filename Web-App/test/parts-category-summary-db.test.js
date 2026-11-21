/**
 * Category filter and category list of the parts read from the summary
 * as soon as it is fresh, and deliver the same as the live query — also for
 * a part whose category only rb_parts knows (the set parts response of
 * Rebrickable mostly delivers none). Measured at 302 000 part rows:
 * category filter 658 → 20 ms, category list 634 → 144 ms.
 *
 * Counter-checks (measured on 29.10.2026):
 *   A  in tryPartsSummary again `if (o.category) return null;` → red: “the
 *      category filter reads from the summary” (source db)
 *   B  rb_parts not asked in partCategoriesQuery (summary) → red:
 *      “the category list is the same on both paths” (kz2 under „Unbekannt“)
 *   C  in partsFilter the condition for spare=1 (tm_k.is_spare, before that the
 *      join on set_parts_catalog) removed → red: “the spare part filter is
 *      the same on both paths”
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

test('category from the summary', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const H = require('./helpers/sources').handlerModule(_req);
  const PS = _req('src/parts/summary.js');
  const NAME = `kategorie-${process.pid}`;
  const SN = `KZ${process.pid}-1`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const U = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  await db.run(
    `INSERT INTO rb_part_categories (id, name) VALUES (98701, 'Steine'), (98702, 'Platten') ON CONFLICT (id) DO NOTHING`,
  );
  await db.run(
    `INSERT INTO rb_parts (part_num, name, part_cat_id) VALUES ('kz2', 'Zwei', 98701) ON CONFLICT (part_num) DO UPDATE SET part_cat_id = 98701`,
  );
  await db.run(`INSERT INTO part_catalog (part_number, part_name, category_name)
                VALUES ('kz1', 'Eins', '98701'), ('kz2', 'Zwei', NULL), ('kz3', 'Drei', '98702')
                ON CONFLICT (part_number) DO UPDATE SET category_name = EXCLUDED.category_name`);
  await db.run(
    `INSERT INTO set_parts (set_number, part_number, color_id, quantity, is_spare)
                VALUES ($1, 'kz1', 5, 4, false), ($1, 'kz2', 5, 2, true), ($1, 'kz3', 1, 3, false)`,
    [SN],
  );
  await holdsSet(db, U, SN, 2);
  for (const [nr, farbe, menge] of [
    ['kz1', 5, 4],
    ['kz2', 5, 2],
    ['kz3', 1, 3],
  ])
    await holdsPart(db, U, nr, { setNumber: SN, colorId: farbe, menge });

  const zeilen = r => r.parts.map(p => `${p.part_number}|${p.color_id}|${p.total_quantity}`).sort();
  const kategorien = l => l.map(k => `${k.category_name}|${k.label}|${k.total_quantity}`).sort();
  const abfrage = { exclude_manual: '1', page: 1, page_size: 50 };

  try {
    // Without exclude_manual the live query always answers; the parts here
    // are all set parts, so the result is the same. The category list
    // first, as long as there is no summary.
    const liveKat = await H.partCategoriesQuery(U);
    const live = await H.partsQuery(U, { page: 1, page_size: 50, category: '98701' });
    const liveSpare = await H.partsQuery(U, { page: 1, page_size: 50, spare: '1' });
    assert.equal(live.source, 'db');
    assert.equal(liveSpare.source, 'db');
    assert.deepEqual(zeilen(live), ['kz1|5|8', 'kz2|5|4'], 'Testdaten: beide Teile der Kategorie, mit Setmenge');
    await PS.rebuildNow(U);

    await t.test('the category filter reads from the summary', async () => {
      const zsf = await H.partsQuery(U, { ...abfrage, category: '98701' });
      assert.equal(zsf.source, 'summary');
      assert.deepEqual(zeilen(zsf), zeilen(live));
    });
    await t.test('the spare part filter is the same on both paths', async () => {
      assert.deepEqual(zeilen(liveSpare), ['kz2|5|4']);
      assert.deepEqual(zeilen(await H.partsQuery(U, { ...abfrage, spare: '1' })), zeilen(liveSpare));
    });
    await t.test('the category list is the same on both paths', async () => {
      assert.deepEqual(kategorien(liveKat), ['98701|Steine|12', '98702|Platten|6']);
      assert.deepEqual(kategorien(await H.partCategoriesQuery(U)), kategorien(liveKat));
    });
  } finally {
    await db.run('DELETE FROM users WHERE id=$1', [U]);
    await db.run('DELETE FROM set_parts WHERE set_number=$1', [SN]);
    await db.run(`DELETE FROM part_catalog WHERE part_number IN ('kz1','kz2','kz3')`);
    await db.run(`DELETE FROM rb_parts WHERE part_num = 'kz2'`);
    await db.run('DELETE FROM rb_part_categories WHERE id IN (98701, 98702)');
    await db.pool.end().catch(() => {});
  }
});
