/**
 * The parts list can be shown without color groups: by name or by
 * quantity. The server sorts the same on both paths (live query and
 * summary, single and in the household), and the UI
 * draws no color tiles when ungrouped.
 *
 * Counter-checks (measured on 29.10.2026):
 *   A  the branch 'name' removed in ordnungSql() (falls back to color)
 *      → red: “the server sorts as chosen on every path” (name)
 *   B  in the household branch of the summary `menge: 'total_quantity'` instead of
 *      SUM(…) → red: “the server sorts as chosen on every path”
 *   C  the switch for the ungrouped list removed in appendParts()
 *      → red: “ungrouped, the UI draws no color tiles”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const { holdsSet, holdsPart } = require('./helpers/inventory');
const { openUi, reiter, warte } = require('./helpers/ui');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();
const H = require('./helpers/sources').handlerModule(_req);
const PS = _req('src/parts/summary.js');

const U = 990611,
  U2 = 990612;

test('order of the parts list', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    noDb(t, e);
    return;
  }
  const aufraeumen = async () => {
    for (const tab of ['parts', 'set_acquisitions', 'sets', 'parts_summary', 'parts_summary_state'])
      await db.run(`DELETE FROM ${tab} WHERE user_id = ANY($1)`, [[U, U2]]);
    await db.run(`DELETE FROM set_parts WHERE set_number IN ('ORD-1', 'ORD-2')`);
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[U, U2]]);
    for (const tab of ['part_color_catalog', 'part_catalog'])
      await db.run(`DELETE FROM ${tab} WHERE part_number = ANY($1)`, [['ORD1', 'ORD2', 'ORD3']]);
    await db.run(`DELETE FROM bl_mapping WHERE rb_id = ANY($1)`, [['ORD1', 'ORD2', 'ORD3']]);
  };
  await aufraeumen();
  t.after(async () => {
    await aufraeumen().catch(() => {});
    await db.pool.end().catch(() => {});
  });

  for (const [id, name] of [
    [U, 'ordnung_a'],
    [U2, 'ordnung_b'],
  ])
    await db.run('INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3)', [id, name, 'x']);
  await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES ('ORD1','Brick'),('ORD2','Plate'),('ORD3','Axle')
                ON CONFLICT (part_number) DO UPDATE SET part_name = EXCLUDED.part_name`);
  await db.run(`INSERT INTO part_color_catalog (part_number, color_id, color_name) VALUES ('ORD1',5,'Rot'),('ORD2',1,'Blau'),('ORD3',3,'Gelb')
                ON CONFLICT (part_number, color_id) DO UPDATE SET color_name = EXCLUDED.color_name`);
  await holdsSet(db, U, 'ORD-1', 1);
  await holdsPart(db, U, 'ORD1', { setNumber: 'ORD-1', quantity: 9, colorId: 5 });
  await holdsPart(db, U, 'ORD2', { setNumber: 'ORD-1', quantity: 1, colorId: 1 });
  await holdsPart(db, U, 'ORD3', { setNumber: 'ORD-1', quantity: 7, colorId: 3 });
  // In the household the second account has the same part: the quantity must sort summed up.
  await holdsSet(db, U2, 'ORD-2', 1);
  await holdsPart(db, U2, 'ORD3', { setNumber: 'ORD-2', quantity: 1, colorId: 3 });

  const EXPECTED = {
    farbe: ['ORD2', 'ORD3', 'ORD1'],
    name: ['ORD3', 'ORD1', 'ORD2'],
    quantity: ['ORD1', 'ORD3', 'ORD2'],
  };
  const abfrage = order => ({ exclude_manual: '1', page: 1, page_size: 50, order });
  const rowList = r => r.parts.map(p => p.part_number);

  await t.test('the server sorts as chosen on every path', async () => {
    const results = [];
    for (const order of Object.keys(EXPECTED)) {
      await db.run('DELETE FROM parts_summary_state WHERE user_id = ANY($1)', [[U, U2]]);
      await db.run('DELETE FROM parts_summary WHERE user_id = ANY($1)', [[U, U2]]);
      const live = await H.partsQuery(U, abfrage(order));
      const liveHousehold = await H.partsQuery([U, U2], abfrage(order));
      await PS.rebuildNow(U);
      await PS.rebuildNow(U2);
      const zsf = await H.partsQuery(U, abfrage(order));
      const sumHousehold = await H.partsQuery([U, U2], abfrage(order));
      for (const [weg, r, source] of [
        ['Live', live, 'db'],
        ['Live Haushalt', liveHousehold, 'db'],
        ['Zusammenfassung', zsf, 'summary'],
        ['Zusammenfassung Haushalt', sumHousehold, 'summary'],
      ])
        results.push({
          order,
          weg,
          source: r.source,
          rowList: rowList(r),
          erwartet: { source, rowList: EXPECTED[order] },
        });
    }
    assert.deepEqual(
      results.map(e => `${e.order}/${e.weg}: ${e.source} ${e.rowList}`),
      results.map(e => `${e.order}/${e.weg}: ${e.erwartet.source} ${e.erwartet.rowList}`),
    );
  });

  await t.test('an unknown value counts as color', async () => {
    assert.deepEqual(rowList(await H.partsQuery(U, abfrage('; DROP TABLE parts'))), ['ORD2', 'ORD3', 'ORD1']);
  });

  await t.test('ungrouped, the UI draws no color tiles', async () => {
    const parts = [
      { part_number: '3003', part_name: 'Axle', color_id: 3, color_name: 'Yellow', total_quantity: 7 },
      { part_number: '3001', part_name: 'Brick', color_id: 5, color_name: 'Red', total_quantity: 3 },
    ];
    const { w, d, aufrufe } = await openUi({ '/v2/parts': { success: true, parts: parts, total: 2 } });
    await reiter(w, 'parts');
    await warte(() => d.querySelectorAll('#parts-main .part-card').length === 2);
    assert.equal(d.querySelectorAll('#parts-main .group-hd').length, 2, 'by colour: one tile per colour');

    const field = d.getElementById('parts-order');
    field.value = 'name';
    field.dispatchEvent(new w.Event('change'));
    await warte(
      () =>
        aufrufe.some(a => a.url.includes('ordnung=name')) && d.querySelectorAll('#parts-main .part-card').length === 2,
    );
    assert.equal(d.querySelectorAll('#parts-main .group-hd').length, 0);
    assert.deepEqual(
      [...d.querySelectorAll('#parts-main .part-card .part-num')].map(e => e.textContent),
      ['3003', '3001'],
    );
    assert.equal(w.localStorage.getItem('bim_parts_order'), 'name', 'the choice stays in the browser');
    w.close();
  });
});
