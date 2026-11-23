/**
 * Part and minifigure without a market price leave behind THE SAME.
 *
 * Counter-check: in src/parts/repository/partsList.ts unit_price read as COALESCE(…, 0) → red “without market price: display value 0, acquisition NULL — for part AND figure”.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();

test('without market price: display value 0, acquisition NULL — for part AND figure', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const name = `mkp_${process.pid}`;
  const PART = `mkpP${String(process.pid).slice(-5)}`;
  const FIG = `mkpF${String(process.pid).slice(-5)}`;
  const u = await db.get(
    `INSERT INTO users (username, password_hash) VALUES ($1,'x')
       ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`,
    [name],
  );
  const uid = u.id;

  try {
    const { addManualPart } = _req('src/parts/manualParts.js');
    const { addManualMinifig } = _req('src/minifigs/manualMinifigs.js');

    // Pass names along so that no Rebrickable lookup is needed. NO price
    // — that is what this is about.
    await addManualPart(uid, { part_number: PART, part_name: 'Testteil', color_id: 0, quantity: 2 });
    await addManualMinifig(uid, { fig_number: FIG, fig_name: 'Testfigur', quantity: 2 });

    // Read via the lists that the UIs use too — the
    // columns no longer exist since migration 0035 (see the header).
    const { manualPartsList } = _req('src/parts/queries.js');
    const { readManualMinifigs } = _req('src/minifigs/queries.js');
    const partsList = await manualPartsList([uid], uid);
    const figList = await readManualMinifigs([uid], uid);
    const part = (Array.isArray(partsList) ? partsList : []).find(p => p.part_number === PART);
    const minifig = (Array.isArray(figList) ? figList : []).find(f => f.fig_number === FIG);
    assert.ok(part, 'The part is not in the list');
    assert.ok(minifig, 'The figure is not in the list');

    // Without input nothing stands in „Preis/Stk" — for both.
    assert.equal(part.unit_price, null, 'The part claims a price input');
    assert.equal(minifig.unit_price, null, 'The figure claims a price input');

    // The actual finding: the display value carries 0, not NULL — and that
    // equally for both.
    assert.equal(Number(part.purchase_price), 0, `The part has ${part.purchase_price} instead of 0 as purchase price`);
    assert.equal(
      Number(minifig.purchase_price),
      0,
      `The figure has ${minifig.purchase_price} instead of 0 as purchase price. src/finances/financeCalc.ts ` +
        'reads NULL as „no purchase price recorded" and 0 as „0 recorded" — the figure ' +
        'would thus behave differently from the part next to it.',
    );
    assert.equal(
      minifig.purchase_price === null,
      part.purchase_price === null,
      'Part and figure disagree whether an unknown market price is NULL or 0',
    );

    // And the finer half: the ACQUISITION holds NULL, not 0.
    // The acquisition tables call the column `unit_price`, not
    // `purchase_price` — looked up, not assumed (\d part_acquisitions).
    // It carries the PRICE OF THIS ACQUISITION; the display value next to it is
    // formed when reading.
    const partAcq2 = await db.get('SELECT unit_price FROM part_acquisitions WHERE user_id=$1 AND part_number=$2', [
      uid,
      PART,
    ]);
    const figErf = await db.get('SELECT unit_price FROM minifig_acquisitions WHERE user_id=$1 AND fig_number=$2', [
      uid,
      FIG,
    ]);
    assert.ok(partAcq2, 'No acquisition was created for the part');
    assert.ok(figErf, 'No acquisition was created for the figure');
    assert.equal(
      partAcq2.unit_price,
      null,
      `The part acquisition carries ${partAcq2.unit_price}; the 0 is a display value ` + 'and does not belong here',
    );
    assert.equal(
      figErf.unit_price,
      null,
      `The figure acquisition carries ${figErf.unit_price} instead of NULL — the conversion ` +
        'was in routes/minifigs.ts at one of three write sites',
    );
  } finally {
    await db.run('DELETE FROM part_acquisitions WHERE user_id=$1', [uid]).catch(() => {});
    await db.run('DELETE FROM minifig_acquisitions WHERE user_id=$1', [uid]).catch(() => {});
    await db.run('DELETE FROM parts WHERE user_id=$1', [uid]).catch(() => {});
    await db.run('DELETE FROM minifigs WHERE user_id=$1', [uid]).catch(() => {});
    await db.run('DELETE FROM users WHERE id=$1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
