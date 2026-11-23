/**
 * What the CSV export writes, the import reads back in — for sets, parts
 * and minifigures. Checked on the round trip itself: account A enters, exports;
 * the file goes into account B (sets: through the import's line reader), and
 * quantity, price, condition, color and date arrive unchanged.
 *
 * Counter-checks (measured on 29.10.2026):
 *   A  in importPartsCsv() no longer read the color (always KEINE_FARBE)
 *      → red: “parts arrive unchanged” (color_id 4 → 9999)
 *   B  in csvSharedFields() no longer read acquired_at → red: “parts …”
 *      and “minifigures …” (date of the import instead of the purchase)
 *   C  in setCsvRows() no longer read the condition → red: “sets …”
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

test('CSV round trip: export and import fit together', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const konto = async n => {
    await db.run('DELETE FROM users WHERE username=$1', [`${n}-${process.pid}`]);
    return (
      await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [`${n}-${process.pid}`])
    ).id;
  };
  const A = await konto('rundlauf-a'),
    B = await konto('rundlauf-b');
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[A, B]]);
    await db.pool.end().catch(() => {});
  });
  for (const u of [A, B])
    await db.run(`INSERT INTO user_settings (user_id,key,value) VALUES ($1,'currency','CHF')`, [u]);

  // Account A: two purchases per kind with all fields the export knows.
  await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1,'RL3001',4,'manual')`, [A]);
  await db.run(`INSERT INTO part_color_catalog (part_number, color_id, color_name) VALUES ('RL3001',4,'Red')
                ON CONFLICT (part_number, color_id) DO NOTHING`);
  await db.run(
    `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition, currency, created_at)
                VALUES ($1,'RL3001',4,3,0.15,'U','CHF','2026-02-01T12:00:00Z'), ($1,'RL3001',4,2,0.2,'N','CHF','2026-03-05T12:00:00Z')`,
    [A],
  );
  await db.run(`INSERT INTO minifigs (user_id, fig_number, source) VALUES ($1,'fig-rl001','manual')`, [A]);
  await db.run(
    `INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, unit_price, condition, currency, created_at)
                VALUES ($1,'fig-rl001',1,12.5,'N','CHF','2026-01-10T12:00:00Z')`,
    [A],
  );
  await db.run(`INSERT INTO sets (user_id, set_number) VALUES ($1,'RL10001-1')`, [A]);
  await db.run(
    `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency, created_at)
                VALUES ($1,'RL10001-1',2,99.9,'U','CHF','2025-12-24T12:00:00Z')`,
    [A],
  );

  const { partsCsv, minifigsCsv } = _req('src/inventory/inventoryExport.js');
  const { setsAsCsv } = require('./helpers/sources').areaPage('sets');
  const { importPartsCsv } = _req('src/parts/manualParts.js');
  const { importMinifigsCsv } = _req('src/minifigs/manualMinifigs.js');
  const { setCsvRows } = require('./helpers/sources').areaPage('sets');

  const acqList = (tabelle, number, farbe, u) =>
    db.all(
      `SELECT ${number}${farbe ? ', color_id' : ''}, quantity, ${tabelle === 'set_acquisitions' ? 'purchase_price' : 'unit_price'}::text AS preis,
            condition, day::text AS tag
       FROM ${tabelle} WHERE user_id=$1 ORDER BY day, condition`,
      [u],
    );

  await t.test('parts arrive unchanged', async () => {
    const r = await importPartsCsv(B, await partsCsv(A));
    assert.equal(r.errors, 0, JSON.stringify(r.results));
    assert.deepEqual(
      await acqList('part_acquisitions', 'part_number', true, B),
      await acqList('part_acquisitions', 'part_number', true, A),
    );
  });

  await t.test('figures arrive unchanged', async () => {
    const r = await importMinifigsCsv(B, await minifigsCsv(A));
    assert.equal(r.errors, 0, JSON.stringify(r.results));
    assert.deepEqual(
      await acqList('minifig_acquisitions', 'fig_number', false, B),
      await acqList('minifig_acquisitions', 'fig_number', false, A),
    );
  });

  await t.test("sets: the import's row reader reads every column of the export", async () => {
    const { rows } = setCsvRows(await setsAsCsv(A));
    assert.deepEqual(rows, [
      { sn: 'RL10001-1', qty: 2, row: 2, purchasePrice: 99.9, condition: 'U', acquiredAt: '2025-12-24' },
    ]);
  });
});
