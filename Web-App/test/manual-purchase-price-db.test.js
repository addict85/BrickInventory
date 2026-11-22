/**
 * Part and minifigure without a market price leave behind THE SAME.
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
    const teil = (Array.isArray(partsList) ? partsList : []).find(p => p.part_number === PART);
    const figur = (Array.isArray(figList) ? figList : []).find(f => f.fig_number === FIG);
    assert.ok(teil, 'Das Teil steht nicht in der Liste');
    assert.ok(figur, 'Die Figur steht nicht in der Liste');

    // Without input nothing stands in „Preis/Stk" — for both.
    assert.equal(teil.unit_price, null, 'Das Teil behauptet eine Preiseingabe');
    assert.equal(figur.unit_price, null, 'Die Figur behauptet eine Preiseingabe');

    // The actual finding: the display value carries 0, not NULL — and that
    // equally for both.
    assert.equal(Number(teil.purchase_price), 0, `Das Teil hat ${teil.purchase_price} statt 0 im Kaufpreis`);
    assert.equal(
      Number(figur.purchase_price),
      0,
      `Die Figur hat ${figur.purchase_price} statt 0 im Kaufpreis. src/finances/financeCalc.ts ` +
        'liest NULL als „kein Kaufpreis erfasst" und 0 als „0 erfasst" — die Figur ' +
        'verhielte sich damit anders als das Teil daneben.',
    );
    assert.equal(
      figur.purchase_price === null,
      teil.purchase_price === null,
      'Teil und Figur sind sich uneins, ob ein unbekannter Marktpreis NULL oder 0 ist',
    );

    // And the finer half: the ACQUISITION holds NULL, not 0.
    // The acquisition tables call the column `unit_price`, not
    // `purchase_price` — looked up, not assumed (\d part_acquisitions).
    // It carries the PRICE OF THIS ACQUISITION; the display value next to it is
    // formed when reading.
    const teilErf = await db.get('SELECT unit_price FROM part_acquisitions WHERE user_id=$1 AND part_number=$2', [
      uid,
      PART,
    ]);
    const figErf = await db.get('SELECT unit_price FROM minifig_acquisitions WHERE user_id=$1 AND fig_number=$2', [
      uid,
      FIG,
    ]);
    assert.ok(teilErf, 'Zum Teil wurde keine Erfassung angelegt');
    assert.ok(figErf, 'Zur Figur wurde keine Erfassung angelegt');
    assert.equal(
      teilErf.unit_price,
      null,
      `Die Teil-Erfassung trägt ${teilErf.unit_price}; die 0 ist ein Anzeigewert ` + 'und gehört hier nicht hin',
    );
    assert.equal(
      figErf.unit_price,
      null,
      `Die Figuren-Erfassung trägt ${figErf.unit_price} statt NULL — die Umwandlung ` +
        'stand in routes/minifigs.ts an einer von drei Schreibstellen',
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
