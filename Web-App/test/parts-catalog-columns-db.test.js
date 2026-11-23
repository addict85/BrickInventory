/**
 * Since db/base.sql the state BEFORE this migration no longer exists: the
 * cases on bolt, addendum and intermediate state are dropped. What is checked is
 * the final state and the read paths.
 *
 *      Counter-check: without the bolt the same situation runs through and the name is gone.
 *   3. The parts list still delivers name, color, image and spare part flag
 *      — via the catalog JOINs.
 *   4. The storage location filter counts. That is no accessory: the count query stood
 *      on `FROM parts p` alone, while the filter condition pointed to lo.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without DB: skip, unless
 * REQUIRE_DB=1.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const { holdsMinifig, holdsSet, holdsPart, catalogSet } = require('./helpers/inventory');
const db = testData();

// The same reasoning as in test/sets-without-purchase-price-column-db.test.js: this
// file builds the database from zero several times and applies migrations by
// hand. Without this follow-up the next test file finds a state
// it does not expect.
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
    console.error('[teile-katalogspalten] Aufraeumen fehlgeschlagen:', e.message);
  }
  await db.pool.end().catch(() => {});
});

const columnsOf = async tabelle =>
  (await db.all(`SELECT column_name FROM information_schema.columns WHERE table_name=$1`, [tabelle]))
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

test('after the whole chain parts and minifigs only carry the inventory', { concurrency: 1 }, async t => {
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

  // ── The promise: only stock any more ─────────────────────────────────────────
  //
  // Marco's list, extended by the columns that concern the STOCK and that
  // he did not name: quantity (piece count), condition, unit_price and
  // purchase_price (the three go into the acquisitions in stage 6) and
  // bl_part_number (goes into the mapping table).
  const nachher = await columnsOf('parts');
  for (const sp of [
    'part_name',
    'color_name',
    'color_hex',
    'category_name',
    'image_url',
    'image_local',
    'is_spare',
    'created_at',
  ]) {
    assert.ok(
      !nachher.includes(sp),
      `parts.${sp} is still there after all migrations — migration 0034 did not ` +
        'delete it, or something creates the column again afterwards.',
    );
  }
  for (const sp of ['id', 'user_id', 'set_number', 'part_number', 'color_id', 'source', 'storage_id', 'added_at']) {
    assert.ok(nachher.includes(sp), `parts.${sp} is missing — exactly these columns are meant to stay in the table`);
  }

  const figsAfter = await columnsOf('minifigs');
  for (const sp of ['fig_name', 'image_url', 'image_local']) {
    assert.ok(!figsAfter.includes(sp), `minifigs.${sp} is still there after all migrations`);
  }
  for (const sp of ['id', 'user_id', 'set_number', 'fig_number', 'source', 'storage_id']) {
    assert.ok(figsAfter.includes(sp), `minifigs.${sp} is missing`);
  }

  // ── And they have not disappeared but moved ───────────────────
  const pc = await columnsOf('part_catalog');
  const pcc = await columnsOf('part_color_catalog');
  const mc = await columnsOf('minifigs_catalog');
  for (const sp of ['part_number', 'part_name', 'category_name']) {
    assert.ok(pc.includes(sp), `part_catalog.${sp} is missing — then the name exists nowhere any more`);
  }
  for (const sp of ['part_number', 'color_id', 'color_name', 'color_hex', 'image_url', 'image_local']) {
    assert.ok(pcc.includes(sp), `part_color_catalog.${sp} is missing`);
  }
  for (const sp of ['fig_number', 'fig_name', 'image_url', 'image_local']) {
    assert.ok(mc.includes(sp), `minifigs_catalog.${sp} is missing`);
  }
  // is_spare does not move into a new catalog: it is a property of the
  // PARTS LIST of a set and has always stood there.
  assert.ok(
    (await columnsOf('set_parts_catalog')).includes('is_spare'),
    'set_parts_catalog.is_spare is missing — then the spare-part flag exists nowhere',
  );
});

test('the parts list delivers description and storage location from the catalogs', { concurrency: 1 }, async t => {
  if (!(await dbDa(t))) return;

  // Fresh, FULLY migrated database — the state of a real
  // installation after the upgrade.
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c0 = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(c0);
  } finally {
    c0.release();
  }

  const u = await db.get(`INSERT INTO users (username,password_hash) VALUES ('teilleser','x') RETURNING id`);
  const uid = u.id;

  // A set with two parts: one required part, one spare part.
  await catalogSet(db, '75192-1', { name: 'Falcon' });
  await holdsSet(db, uid, '75192-1', 2);
  await db.run(`INSERT INTO set_parts (set_number,part_number,color_id,is_spare,quantity)
    VALUES ('75192-1','3001',4,false,6), ('75192-1','3002',1,true,2)`);
  await db.run(`INSERT INTO part_catalog (part_number,part_name,category_name)
    VALUES ('3001','Brick 2x4','Bricks'),('3002','Brick 2x3','Bricks')`);
  await db.run(`INSERT INTO part_color_catalog (part_number,color_id,color_name,color_hex,image_url)
    VALUES ('3001',4,'Red','C91A09','http://cdn/3001r.png'),
           ('3002',1,'Blue','0055BF','http://cdn/3002b.png')`);
  const location = await db.get(`INSERT INTO storage_locations (user_id,name) VALUES ($1,'Kiste 3') RETURNING id`, [
    uid,
  ]);
  // Since migration 0038 the piece count stands in the set parts catalog, not on
  // the row — holdsPart() creates both.
  await holdsPart(db, uid, '3001', { setNumber: '75192-1', quantity: 6, colorId: 4, storageId: location.id });
  await holdsPart(db, uid, '3002', { setNumber: '75192-1', quantity: 2, colorId: 1 });

  const handlers = _req('src/parts/queries.js');

  // ── The description arrives ────────────────────────────────────────────
  const alle = await handlers.partsQuery(uid, { exclude_manual: '1' });
  const nach = nr => alle.parts.find(p => String(p.part_number) === nr);
  assert.equal(alle.parts.length, 2, `Expected 2 parts, got ${alle.parts.length}: ${JSON.stringify(alle.parts)}`);
  assert.equal(nach('3001')?.part_name, 'Brick 2x4', 'The part name does not arrive from part_catalog');
  assert.equal(nach('3001')?.color_name, 'Red', 'The colour name does not arrive from part_color_catalog');
  assert.equal(nach('3001')?.color_hex, 'C91A09', 'The colour code does not arrive');
  assert.equal(nach('3001')?.category_name, 'Bricks', 'The category does not arrive');
  assert.equal(nach('3001')?.image_url, 'http://cdn/3001r.png', 'The image does not arrive');
  // Quantity: 6 parts per set, 2 sets in the stock.
  assert.equal(nach('3001')?.total_quantity, 12, 'The quantity is no longer multiplied by the set count');

  // ── is_spare from set_parts_catalog, as a real boolean ─────────────
  assert.equal(nach('3001')?.is_spare, false, 'A required part is reported as a spare part');
  assert.equal(nach('3002')?.is_spare, true, 'The spare-part flag does not arrive from set_parts_catalog');
  const nurErsatz = await handlers.partsQuery(uid, { exclude_manual: '1', spare: '1' });
  assert.deepEqual(
    nurErsatz.parts.map(p => String(p.part_number)),
    ['3002'],
    `spare=1 does not filter via set_parts_catalog: ${JSON.stringify(nurErsatz.parts.map(p => p.part_number))}`,
  );

  // ── The color filter ───────────────────────────────────────────────────────
  const nurRot = await handlers.partsQuery(uid, { exclude_manual: '1', color: 'Red' });
  assert.deepEqual(
    nurRot.parts.map(p => String(p.part_number)),
    ['3001'],
    'The colour filter does not work via part_color_catalog',
  );

  // The storage location filter — and its COUNT
  const inBox = await handlers.partsQuery(uid, { exclude_manual: '1', storage: 'Kiste 3' });
  assert.deepEqual(
    inBox.parts.map(p => String(p.part_number)),
    ['3001'],
    'The location filter returns the wrong parts',
  );
  assert.equal(
    inBox.total,
    1,
    `The count query of the location filter returns ${inBox.total} instead of 1 — ` +
      'it needs the same JOINs as the main query (joinClause)',
  );
  assert.equal(inBox.parts[0].storage, 'Kiste 3', 'The location name does not arrive from storage_locations');

  // ── Search via the catalog name ──────────────────────────────────────────
  const sought = await handlers.partsQuery(uid, { exclude_manual: '1', search: 'brick 2x3' });
  assert.deepEqual(
    sought.parts.map(p => String(p.part_number)),
    ['3002'],
    'The search no longer finds the part name (it is in part_catalog)',
  );
});

test('the figure list delivers name and image from minifigs_catalog', { concurrency: 1 }, async t => {
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

  const u = await db.get(`INSERT INTO users (username,password_hash) VALUES ('figleser','x') RETURNING id`);
  const uid = u.id;
  await catalogSet(db, '75192-1', { name: 'Falcon' });
  await holdsSet(db, uid, '75192-1', 3);
  await db.run(`INSERT INTO minifigs_catalog (fig_number,fig_name,image_url)
    VALUES ('fig-000123','Chewbacca','http://cdn/chewie.png')`);
  await holdsMinifig(db, uid, 'fig-000123', { setNumber: '75192-1', quantity: 1 });

  const handlers = _req('src/minifigs/queries.js');
  const liste = await handlers.readMinifigs(uid, {});
  const figs = liste.minifigs || liste.figs || liste;
  const f = (Array.isArray(figs) ? figs : []).find(x => x.fig_number === 'fig-000123');
  assert.ok(f, `The figure is missing in the response: ${JSON.stringify(liste).slice(0, 400)}`);
  assert.equal(f.fig_name, 'Chewbacca', 'The figure name does not arrive from minifigs_catalog');
  assert.equal(f.image_url, 'http://cdn/chewie.png', 'The figure image does not arrive');
  assert.equal(Number(f.total_quantity), 3, 'The quantity is no longer multiplied by the set count');

  // The search runs via the catalog name.
  const sought = await handlers.readMinifigs(uid, { search: 'chewb' });
  const gFigs = sought.minifigs || sought.figs || sought;
  assert.equal(
    (Array.isArray(gFigs) ? gFigs : []).length,
    1,
    'The search no longer finds the figure name (it is in minifigs_catalog)',
  );
});
