/**
 * Migration 0108 and the readers afterwards: catalog_cache only keeps the
 * fetch state; details are in rb_sets, the image in set_catalog. The migration
 * runs on a legacy stock in its own schema (search_path).
 *
 * Counter-checks (measured on 11.11.2026, each alone):
 *   A  the INSERT INTO rb_sets … FROM catalog_cache removed → red: “what only
 *      a fetch knew is in rb_sets afterwards”
 *   B  in the migration's ON CONFLICT `WHERE rb_sets.herkunft = 'api'` removed →
 *      red: the same (the CSV row 5555-1 gets the year 1999)
 *   B2 `name = EXCLUDED.name` instead of only replacing the placeholder → red:
 *      the same (6100-1 is called “Anderer Name”)
 *   C  the INSERT INTO set_catalog … of the migration removed → red: “the image
 *      is in set_catalog afterwards”
 *   D  rememberSet() again writes only catalog_cache (rememberSetCatalog call
 *      removed) → red: “a fetch lands in rb_sets”
 *   E  setMaster() reads COALESCE(c.image_url, rs.set_img_url) again → red:
 *      “set master: the image only from set_catalog”
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
const MIGRATION = fs.readFileSync(
  path.join(__dirname, '..', 'db/migrations/0108-catalog-cache-nur-abrufstand.sql'),
  'utf8',
);
const SCHEMA = `probe0108_${process.pid}`;

test('catalog_cache only the fetch state now', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const c = await db.pool.connect();
  t.after(async () => {
    await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
    c.release();
    await db.pool.end().catch(() => {});
  });

  await t.test('migration on legacy data', async tt => {
    await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await c.query(`CREATE SCHEMA ${SCHEMA}`);
    await c.query(`SET search_path TO ${SCHEMA}, public`);
    for (const tab of ['rb_sets', 'rb_themes', 'set_catalog', 'catalog_cache'])
      await c.query(`CREATE TABLE ${tab} (LIKE public.${tab} INCLUDING ALL)`);
    // Migration 0124 (after 0108) renamed the column; the migration from back then still knows the old name.
    await c.query(`ALTER TABLE rb_sets RENAME COLUMN source TO herkunft`);
    await c.query(`ALTER TABLE catalog_cache ADD COLUMN name text, ADD COLUMN year integer, ADD COLUMN theme text,
                   ADD COLUMN pieces integer, ADD COLUMN image_url text`);
    await c.query(`INSERT INTO rb_themes (id, name, parent_id) VALUES (1, 'Star Wars', NULL)`);
    await c.query(`INSERT INTO rb_sets (set_num, name, year, theme_id, num_parts, set_img_url, herkunft) VALUES
      ('75192-1', 'Millennium Falcon', 2017, 1, 7541, 'https://csv/75192.jpg', 'csv'),
      ('6000-1', 'Set 6000-1', NULL, NULL, NULL, NULL, 'api'),
      ('6100-1', 'Eigener Name', NULL, NULL, NULL, NULL, 'api'),
      ('5555-1', 'CSV ohne Jahr', NULL, 1, 20, NULL, 'csv')`);
    await c.query(`INSERT INTO set_catalog (set_number) VALUES ('75192-1'), ('6000-1'), ('6100-1'), ('5555-1')`);
    await c.query(`INSERT INTO catalog_cache (set_number, name, year, theme, pieces, image_url, is_gear, bl_type) VALUES
      ('75192-1', 'Anderer Name', 2000, 'Star Wars', 1, 'https://abruf/75192.jpg', false, NULL),
      ('6000-1', 'Promo', 2020, 'Star Wars', 10, 'https://abruf/6000.jpg', false, NULL),
      ('7000-1', 'Nur Abruf', 2019, NULL, 5, 'https://abruf/7000.jpg', false, NULL),
      ('6100-1', 'Anderer Name', 2018, NULL, NULL, NULL, false, NULL),
      ('5555-1', 'Fremd', 1999, NULL, 30, NULL, false, NULL),
      ('8000-1', 'Set 8000-1', NULL, NULL, NULL, NULL, true, 'NONE')`);

    await c.query(MIGRATION);

    await tt.test('what only a fetch knew is in rb_sets afterwards', async () => {
      assert.deepEqual(
        (
          await c.query(
            'SELECT set_num, name, year, theme_id, num_parts, herkunft AS provenance FROM rb_sets ORDER BY 1',
          )
        ).rows,
        [
          { set_num: '5555-1', name: 'CSV ohne Jahr', year: null, theme_id: 1, num_parts: 20, provenance: 'csv' },
          { set_num: '6000-1', name: 'Promo', year: 2020, theme_id: 1, num_parts: 10, provenance: 'api' },
          { set_num: '6100-1', name: 'Eigener Name', year: 2018, theme_id: null, num_parts: null, provenance: 'api' },
          { set_num: '7000-1', name: 'Nur Abruf', year: 2019, theme_id: null, num_parts: 5, provenance: 'api' },
          {
            set_num: '75192-1',
            name: 'Millennium Falcon',
            year: 2017,
            theme_id: 1,
            num_parts: 7541,
            provenance: 'csv',
          },
        ],
      );
    });

    await tt.test('the image is in set_catalog afterwards', async () => {
      assert.deepEqual((await c.query('SELECT set_number, image_url FROM set_catalog ORDER BY 1')).rows, [
        { set_number: '5555-1', image_url: null },
        { set_number: '6000-1', image_url: 'https://abruf/6000.jpg' },
        { set_number: '6100-1', image_url: null },
        { set_number: '7000-1', image_url: 'https://abruf/7000.jpg' },
        { set_number: '75192-1', image_url: 'https://csv/75192.jpg' },
      ]);
    });

    await tt.test('catalog_cache only keeps the fetch state', async () => {
      const columns = (
        await c.query(
          `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'catalog_cache' ORDER BY ordinal_position`,
          [SCHEMA],
        )
      ).rows.map(r => r.column_name);
      assert.deepEqual(columns, ['set_number', 'is_gear', 'bl_type', 'fetched_at']);
      assert.equal((await c.query('SELECT count(*)::int AS n FROM catalog_cache')).rows[0].n, 6);
    });
    await c.query('SET search_path TO public');
  });

  const cache = _req('src/catalog/repository/rebrickableCache.js');
  const detail = _req('src/sets/repository/setDetail.js');

  await t.test('a fetch lands in rb_sets, and the cache reads it from there', async () => {
    await db.run(`INSERT INTO rb_themes (id, name) VALUES (158, 'Star Wars') ON CONFLICT DO NOTHING`);
    await cache.rememberSet(db, {
      set_number: '4242-1',
      name: 'Abgerufen',
      year: 2021,
      theme: 'Star Wars',
      pieces: 99,
      image_url: 'https://abruf/4242.jpg',
      theme_id: 158,
    });
    assert.deepEqual(
      await db.get(`SELECT name, year, theme_id, num_parts, source FROM rb_sets WHERE set_num = '4242-1'`),
      { name: 'Abgerufen', year: 2021, theme_id: 158, num_parts: 99, source: 'api' },
    );
    const z = await cache.catalogSetTo(db, '4242-1');
    assert.equal(z.name, 'Abgerufen');
    assert.equal(z.theme, 'Star Wars');
    assert.equal(z.image_url, 'https://abruf/4242.jpg');
    assert.equal(z.is_gear, false);
  });

  await t.test('set master: the image only from set_catalog', async () => {
    await db.run(
      `INSERT INTO rb_sets (set_num, name, year, set_img_url) VALUES ('4343-1', 'Nur CSV-Bild', 2020, 'https://csv/4343.jpg')`,
    );
    await db.run(`INSERT INTO set_catalog (set_number) VALUES ('4343-1')`);
    const s = await detail.setMaster(db, '4343-1');
    assert.equal(s.name, 'Nur CSV-Bild');
    assert.equal(s.image_url, null);
    await db.run(`UPDATE set_catalog SET image_url = 'https://katalog/4343.jpg' WHERE set_number = '4343-1'`);
    assert.equal((await detail.setMaster(db, '4343-1')).image_url, 'https://katalog/4343.jpg');
  });
});
