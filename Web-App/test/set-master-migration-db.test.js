/**
 * Migration 0105: rb_sets is the only source for name, year, theme and
 * part count; set_catalog becomes 1:1 to it and only keeps the additions. Runs on
 * legacy data in its own schema (search_path), the real database
 * stays untouched.
 *
 * Counter-checks (measured on 10.11.2026, each on its own in the migration):
 *   A  the INSERT INTO rb_sets … FROM set_catalog removed → red: the migration
 *      fails on set_catalog_rb_sets_fkey (5008-1 without an rb_sets row)
 *   B  the INSERT INTO set_catalog … FROM rb_sets removed → red: “every rb_sets row
 *      has its set_catalog row” (10497-1 missing)
 *   C  `COALESCE(sc.name, 'Set ' || sc.set_number)` replaced by `sc.name` → red:
 *      “a set only from set_catalog …” (null instead of „Set 9999-1“)
 *   D  in the theme lookup `ORDER BY t.parent_id NULLS FIRST, t.id` to
 *      `ORDER BY t.id DESC` → red: “… the theme via its name” (2 instead of 1)
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
const MIGRATION = fs.readFileSync(path.join(__dirname, '..', 'db/migrations/0105-set-stamm-aus-rb-sets.sql'), 'utf8');
const SCHEMA = `probe0105_${process.pid}`;

test('migration 0105: set master from rb_sets', { concurrency: 1 }, async t => {
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
  // State before 0105: rb_sets without herkunft, set_catalog with its own master columns.
  for (const tab of ['rb_sets', 'rb_themes', 'set_catalog'])
    await c.query(`CREATE TABLE ${tab} (LIKE public.${tab} INCLUDING ALL)`);
  await c.query('ALTER TABLE rb_sets DROP COLUMN source');
  await c.query(
    'ALTER TABLE set_catalog ADD COLUMN name text, ADD COLUMN year integer, ADD COLUMN theme text, ADD COLUMN pieces integer',
  );
  await c.query('CREATE VIEW set_stamm AS SELECT set_number, name FROM set_catalog');

  await c.query(
    `INSERT INTO rb_themes (id, name, parent_id) VALUES (1, 'Star Wars', NULL), (2, 'Star Wars', 1), (3, 'Icons', NULL)`,
  );
  await c.query(`INSERT INTO rb_sets (set_num, name, year, theme_id, num_parts) VALUES
    ('75192-1', 'Millennium Falcon', 2017, 1, 7541), ('10497-1', 'Galaxy Explorer', 2022, 3, 1254)`);
  await c.query(`INSERT INTO set_catalog (set_number, name, year, theme, pieces, minifigs, image_url, image_local, brickset_id) VALUES
    ('75192-1', 'Alter Name', 2016, 'Icons', 1, 8, 'https://cdn/75192.jpg', '/images/sets/75192-1.jpg', 77),
    ('5008-1', 'Promo', 2022, 'Star Wars', 50, 1, NULL, '/images/sets/5008-1.jpg', NULL),
    ('9999-1', NULL, NULL, 'Unbekannt', NULL, NULL, NULL, NULL, NULL)`);

  await t.test('the migration runs', async () => {
    await c.query(MIGRATION);
  });

  await t.test('rb_sets leads; a set only from set_catalog becomes an api row, the theme via its name', async () => {
    assert.deepEqual(
      (await c.query('SELECT set_num, name, year, theme_id, num_parts, herkunft AS provenance FROM rb_sets ORDER BY 1'))
        .rows,
      [
        { set_num: '10497-1', name: 'Galaxy Explorer', year: 2022, theme_id: 3, num_parts: 1254, provenance: 'csv' },
        { set_num: '5008-1', name: 'Promo', year: 2022, theme_id: 1, num_parts: 50, provenance: 'api' },
        { set_num: '75192-1', name: 'Millennium Falcon', year: 2017, theme_id: 1, num_parts: 7541, provenance: 'csv' },
        { set_num: '9999-1', name: 'Set 9999-1', year: null, theme_id: null, num_parts: null, provenance: 'api' },
      ],
    );
  });

  await t.test('every rb_sets row has its set_catalog row, the additions stay', async () => {
    assert.deepEqual(
      (await c.query('SELECT * FROM set_catalog ORDER BY set_number')).rows.map(({ updated_at: _u, ...z }) => z),
      [
        { set_number: '10497-1', minifigs: null, image_url: null, image_local: null, brickset_id: null },
        {
          set_number: '5008-1',
          minifigs: 1,
          image_url: null,
          image_local: '/images/sets/5008-1.jpg',
          brickset_id: null,
        },
        {
          set_number: '75192-1',
          minifigs: 8,
          image_url: 'https://cdn/75192.jpg',
          image_local: '/images/sets/75192-1.jpg',
          brickset_id: 77,
        },
        { set_number: '9999-1', minifigs: null, image_url: null, image_local: null, brickset_id: null },
      ],
    );
  });

  await t.test('set_catalog hangs on rb_sets, set_stamm is gone', async () => {
    await assert.rejects(c.query(`INSERT INTO set_catalog (set_number) VALUES ('1234-1')`), { code: '23503' });
    await c.query(`DELETE FROM rb_sets WHERE set_num = '9999-1'`);
    assert.equal(
      (await c.query(`SELECT count(*)::int AS n FROM set_catalog WHERE set_number = '9999-1'`)).rows[0].n,
      0,
      'ON DELETE CASCADE',
    );
    assert.equal((await c.query(`SELECT to_regclass('${SCHEMA}.set_stamm') AS v`)).rows[0].v, null);
  });
});
