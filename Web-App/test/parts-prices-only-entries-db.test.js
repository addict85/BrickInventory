/**
 * Since db/base.sql the state BEFORE this migration no longer exists: the
 * cases on bolt, addendum and intermediate state are dropped. What is checked is
 * the final state and the read paths.
 *
 * Counter-check: conditionFromAcquisitions() (src/inventory/shared.ts) always returns 'N' → red “the lists deliver price and condition from the newest acquisition”.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();
const { holdsMinifig, holdsPart } = require('./helpers/inventory');

// The same reasoning as in test/sets-without-purchase-price-column-db.test.js: this
// file builds the database from zero several times.
test.after(async () => {
  try {
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
    await db.initSchema();
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  } catch (e) {
    console.error('[teilepreise-nur-erfassungen] Aufraeumen fehlgeschlagen:', e.message);
  }
  await db.pool.end().catch(() => {});
});

const columnsOf = async table =>
  (await db.all(`SELECT column_name FROM information_schema.columns WHERE table_name=$1`, [table]))
    .map(r => r.column_name)
    .sort();

const dbDa = async t => {
  try {
    await db.run('SELECT 1');
    return true;
  } catch (e) {
    noDb(t, e);
    return false;
  }
};

test('after the whole chain parts and minifigs carry no price any more', { concurrency: 1 }, async t => {
  if (!(await dbDa(t))) return;

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();

  // The state before the migrations no longer exists: an empty
  // database gets db/base.sql. What is checked is the final state.
  const client = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(client);
  } finally {
    client.release();
  }

  const later = await columnsOf('parts');
  for (const sp of ['unit_price', 'purchase_price', 'condition']) {
    assert.ok(
      !later.includes(sp),
      `parts.${sp} is still there after all migrations — migration 0035 did not ` +
        'delete it, or something creates the column again afterwards.',
    );
  }
  // And the stock is still there: Marco's list, plus what does NOT concern the purchase.
  // bl_part_number stood here and is gone: migration 0037 deleted it,
  // the BrickLink number stands in bl_mapping (once per part instead of per
  // account). See test/bricklink-mapping-db.test.js. …
  for (const sp of ['id', 'user_id', 'set_number', 'part_number', 'color_id', 'source', 'storage_id', 'added_at']) {
    assert.ok(later.includes(sp), `parts.${sp} is missing — the column belongs to the stock`);
  }

  const figsAfter = await columnsOf('minifigs');
  for (const sp of ['unit_price', 'purchase_price', 'condition']) {
    assert.ok(!figsAfter.includes(sp), `minifigs.${sp} is still there after all migrations`);
  }

  // Not disappeared but moved.
  for (const [tab, columns] of [
    ['part_acquisitions', ['user_id', 'part_number', 'color_id', 'quantity', 'unit_price', 'condition', 'created_at']],
    ['minifig_acquisitions', ['user_id', 'fig_number', 'quantity', 'unit_price', 'condition', 'created_at']],
  ]) {
    const existing = await columnsOf(tab);
    for (const sp of columns) {
      assert.ok(existing.includes(sp), `${tab}.${sp} is missing — then the purchase price exists nowhere any more`);
    }
  }
});

test('the lists deliver price and condition from the newest acquisition', { concurrency: 1 }, async t => {
  if (!(await dbDa(t))) return;

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c0 = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(c0);
  } finally {
    c0.release();
  }

  const u = await db.get(`INSERT INTO users (username,password_hash) VALUES ('preisleser','x') RETURNING id`);
  const uid = u.id;

  await db.run(`INSERT INTO part_catalog (part_number,part_name) VALUES ('3002','Brick 2x3')
                ON CONFLICT (part_number) DO NOTHING`);
  await db.run(`INSERT INTO part_color_catalog (part_number,color_id,color_name)
                VALUES ('3002',1,'Blau') ON CONFLICT (part_number,color_id) DO NOTHING`);
  await db.run(`INSERT INTO minifigs_catalog (fig_number,fig_name) VALUES ('fig-5','Testfigur')
                ON CONFLICT (fig_number) DO NOTHING`);
  // Only the stock rows, without quantity: the two acquisitions further down
  // carry it (migration 0038). holdsPart() with menge 0 therefore creates no
  // acquisition of its own — the daily rule would not allow a second one next to it.
  await holdsPart(db, uid, '3002', { quantity: 0, colorId: 1 });
  await holdsMinifig(db, uid, 'fig-5', { quantity: 0 });

  // TWO acquisitions, different days and conditions. The newer one is the one that
  // must be shown as „the price of this part" — the older one must not
  // cover it.
  await db.run(
    `INSERT INTO part_acquisitions (user_id,part_number,color_id,quantity,unit_price,condition,created_at)
                VALUES ($1,'3002',1,2,1.00,'N', NOW() - INTERVAL '3 days'),
                       ($1,'3002',1,3,2.00,'U', NOW() - INTERVAL '1 day')`,
    [uid],
  );
  await db.run(
    `INSERT INTO minifig_acquisitions (user_id,fig_number,quantity,unit_price,condition,created_at)
                VALUES ($1,'fig-5',1,5.00,'N', NOW() - INTERVAL '2 days'),
                       ($1,'fig-5',2,7.50,'U', NOW())`,
    [uid],
  );

  const H = _req('src/parts/queries.js');
  const M = _req('src/minifigs/queries.js');

  const parts = await H.manualPartsList([uid], uid);
  const part = (Array.isArray(parts) ? parts : parts.parts || []).find(p => p.part_number === '3002');
  assert.ok(part, `The part is missing in the response: ${JSON.stringify(parts).slice(0, 300)}`);
  assert.equal(Number(part.unit_price), 2.0, 'unit_price must be the price of the NEWEST acquisition');
  assert.equal(Number(part.purchase_price), 2.0, 'purchase_price is the display value and must not be empty');
  assert.equal(part.condition, 'U', 'A used acquisition makes the part used (conditionFromAcquisitions)');

  const figs = await M.readManualMinifigs([uid], uid);
  const fig = (Array.isArray(figs) ? figs : figs.minifigs || []).find(f => f.fig_number === 'fig-5');
  assert.ok(fig, `The figure is missing in the response: ${JSON.stringify(figs).slice(0, 300)}`);
  assert.equal(Number(fig.unit_price), 7.5, 'unit_price must be the price of the NEWEST acquisition');
  assert.equal(fig.condition, 'U', 'A used acquisition makes the figure used');

  // ── And without a price the display value stays 0, not empty ──────────────────
  //
  // src/finances/priceRule.ts distinguishes the two meanings: in the acquisition
  // NULL means „no price known", the display value is 0 then. Before
  // migration 0035 this 0 stood in parts.purchase_price; now the
  // read query forms it.
  await db.run(`INSERT INTO part_catalog (part_number,part_name) VALUES ('3003','Plate 1x1')
                ON CONFLICT (part_number) DO NOTHING`);
  // quantity 0 for the stock row, the acquisition comes below with an
  // EXPLICITLY empty price — that is the statement of this case.
  await holdsPart(db, uid, '3003', { quantity: 0, colorId: 0 });
  await db.run(
    `INSERT INTO part_acquisitions (user_id,part_number,color_id,quantity,unit_price,condition)
                VALUES ($1,'3003',0,1,NULL,'N')`,
    [uid],
  );
  const parts2 = await H.manualPartsList([uid], uid);
  const withoutPrice = (Array.isArray(parts2) ? parts2 : parts2.parts || []).find(p => p.part_number === '3003');
  assert.ok(withoutPrice, 'The part without a price is missing in the response');
  assert.equal(
    withoutPrice.unit_price,
    null,
    'Without a price unit_price must be empty — that is the statement „nothing entered"',
  );
  assert.equal(
    Number(withoutPrice.purchase_price),
    0,
    'The display value must be 0, not empty — see src/finances/priceRule.ts',
  );
});
