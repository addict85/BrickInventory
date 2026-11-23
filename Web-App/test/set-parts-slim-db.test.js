/**
 * Migration 0062: the set list only keeps set, part, color, quantity and
 * spare part; name, category, color and image stand in the catalogs. The view
 * set_parts_catalog shows the read places the same columns — and as before
 * only verified values, no typed-in placeholder of an account.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  the filter `CASE WHEN pc.name_von IS NULL …` left out in the view
 *      → red: “a placeholder does not appear in the set list”
 *   B  in the migration COALESCE(catalog, set list) without replacing the
 *      placeholder → red: “the verified name from the set list replaces the
 *      placeholder”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const MIGRATION = fs.readFileSync(path.join(__dirname, '..', 'db/migrations/0062-set-teile-schlank.sql'), 'utf8');
const SCHEMA = `probe0062_${process.pid}`;

test('migration 0062: slim set list', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;
  const c = await db.pool.connect();
  t.after(async () => {
    await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
    c.release();
    await db.pool.end().catch(() => {});
  });
  await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await c.query(`CREATE SCHEMA ${SCHEMA}`);
  await c.query(`SET search_path TO ${SCHEMA}, public`);
  // The legacy data: catalogs as today, the set list in its form before 0062.
  await c.query(`CREATE TABLE part_catalog (LIKE public.part_catalog INCLUDING ALL)`);
  await c.query(`CREATE TABLE part_color_catalog (LIKE public.part_color_catalog INCLUDING ALL)`);
  // The origin columns from 0060 to 0093.
  await c.query(`ALTER TABLE part_catalog ADD COLUMN name_von integer, ADD COLUMN kategorie_von integer`);
  await c.query(
    `ALTER TABLE part_color_catalog ADD COLUMN farbname_von integer, ADD COLUMN farbcode_von integer, ADD COLUMN bild_von integer`,
  );
  await c.query(`CREATE TABLE set_parts_catalog (
    set_number text NOT NULL, part_number text NOT NULL, part_name text, color_id integer NOT NULL,
    color_name text, color_hex text, category_name text, image_url text, image_local text,
    is_spare integer DEFAULT 0, quantity integer DEFAULT 1, updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT set_parts_catalog_pkey PRIMARY KEY (set_number, part_number, color_id))`);
  await c.query(`CREATE INDEX idx_spc_set ON set_parts_catalog (set_number)`);
  await c.query(`INSERT INTO set_parts_catalog VALUES
    ('75192-1', '3001', 'Brick 2 x 4', 4, 'Red', 'C91A09', 'Bricks', 'https://cdn.rebrickable.com/3001.jpg', '/images/parts/3001_4.jpg', 0, 6),
    ('75192-1', '3002', 'Brick 2 x 3', 1, 'Blue', '0055BF', 'Bricks', NULL, NULL, 1, 2)`);
  // An account had typed in 3001 as a placeholder before; 3002 stands there verified.
  await c.query(`INSERT INTO part_catalog (part_number, part_name, name_von) VALUES ('3001', 'Annas Stein', 42)`);
  await c.query(`INSERT INTO part_catalog (part_number, part_name) VALUES ('3002', 'Brick 2x3 geprüft')`);
  await c.query(MIGRATION);
  // A placeholder AFTER the migration, for the question what the view shows.
  await c.query(`INSERT INTO part_catalog (part_number, part_name, name_von) VALUES ('3003', 'Brunos Stein', 43)`);
  await c.query(`INSERT INTO set_teile (set_number, part_number, color_id, quantity) VALUES ('75192-1', '3003', 0, 1)`);

  const row = async nr =>
    (await c.query(`SELECT * FROM set_parts_catalog WHERE set_number = '75192-1' AND part_number = $1`, [nr])).rows[0];

  await t.test('the set list only has its own columns', async () => {
    const columns = (
      await c.query(
        `SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'set_teile' ORDER BY column_name`,
        [SCHEMA],
      )
    ).rows.map(r => r.column_name);
    assert.deepEqual(columns, ['color_id', 'is_spare', 'part_number', 'quantity', 'set_number', 'updated_at']);
  });

  await t.test('the view shows the same values as before', async () => {
    const z = await row('3001');
    assert.equal(z.color_name, 'Red');
    assert.equal(z.color_hex, 'C91A09');
    assert.equal(z.category_name, 'Bricks');
    assert.equal(z.image_url, 'https://cdn.rebrickable.com/3001.jpg');
    assert.equal(z.image_local, '/images/parts/3001_4.jpg');
    assert.equal(z.quantity, 6);
    assert.equal((await row('3002')).is_spare, 1);
  });

  await t.test('the verified name from the set list replaces the placeholder', async () => {
    assert.equal((await row('3001')).part_name, 'Brick 2 x 4');
    const k = (await c.query(`SELECT part_name, name_von AS name_from FROM part_catalog WHERE part_number = '3001'`))
      .rows[0];
    assert.deepEqual(k, { part_name: 'Brick 2 x 4', name_from: null });
  });

  await t.test('an existing verified value stays', async () => {
    assert.equal((await row('3002')).part_name, 'Brick 2x3 geprüft');
  });

  await t.test('a placeholder does not appear in the set list', async () => {
    assert.equal((await row('3003')).part_name, null);
  });
});
