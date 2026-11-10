/**
 * Migration 0105: rb_sets ist die einzige Quelle für Name, Jahr, Thema und
 * Teilezahl; set_catalog wird 1:1 dazu und behält nur die Ergänzungen. Läuft auf
 * einem Altbestand in einem eigenen Schema (search_path), die echte Datenbank
 * bleibt unberührt.
 *
 * Gegenproben (am 10.11.2026 gemessen, je einzeln in der Migration):
 *   A  das INSERT INTO rb_sets … FROM set_catalog entfernt → rot: die Migration
 *      scheitert an set_catalog_rb_sets_fkey (5008-1 ohne rb_sets-Zeile)
 *   B  das INSERT INTO set_catalog … FROM rb_sets entfernt → rot: „jede rb_sets-Zeile
 *      hat ihre set_catalog-Zeile“ (10497-1 fehlt)
 *   C  `COALESCE(sc.name, 'Set ' || sc.set_number)` durch `sc.name` ersetzt → rot:
 *      „ein Set nur aus set_catalog …“ (null statt „Set 9999-1“)
 *   D  im Themen-Nachschlag `ORDER BY t.parent_id NULLS FIRST, t.id` zu
 *      `ORDER BY t.id DESC` → rot: „… das Thema über seinen Namen“ (2 statt 1)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');
const MIGRATION = fs.readFileSync(path.join(__dirname, '..', 'db/migrations/0105-set-stamm-aus-rb-sets.sql'), 'utf8');
const SCHEMA = `probe0105_${process.pid}`;

test('Migration 0105: Set-Stamm aus rb_sets', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req, { migrieren: false }))) return;
  const c = await db.pool.connect();
  t.after(async () => {
    await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
    c.release();
    await db.pool.end().catch(() => {});
  });
  await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await c.query(`CREATE SCHEMA ${SCHEMA}`);
  await c.query(`SET search_path TO ${SCHEMA}, public`);
  // Stand vor 0105: rb_sets ohne herkunft, set_catalog mit eigenen Stammspalten.
  for (const tab of ['rb_sets', 'rb_themes', 'set_catalog'])
    await c.query(`CREATE TABLE ${tab} (LIKE public.${tab} INCLUDING ALL)`);
  await c.query('ALTER TABLE rb_sets DROP COLUMN herkunft');
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

  await t.test('die Migration läuft', async () => {
    await c.query(MIGRATION);
  });

  await t.test(
    'rb_sets führt; ein Set nur aus set_catalog wird eine api-Zeile, das Thema über seinen Namen',
    async () => {
      assert.deepEqual(
        (await c.query('SELECT set_num, name, year, theme_id, num_parts, herkunft FROM rb_sets ORDER BY 1')).rows,
        [
          { set_num: '10497-1', name: 'Galaxy Explorer', year: 2022, theme_id: 3, num_parts: 1254, herkunft: 'csv' },
          { set_num: '5008-1', name: 'Promo', year: 2022, theme_id: 1, num_parts: 50, herkunft: 'api' },
          { set_num: '75192-1', name: 'Millennium Falcon', year: 2017, theme_id: 1, num_parts: 7541, herkunft: 'csv' },
          { set_num: '9999-1', name: 'Set 9999-1', year: null, theme_id: null, num_parts: null, herkunft: 'api' },
        ],
      );
    },
  );

  await t.test('jede rb_sets-Zeile hat ihre set_catalog-Zeile, die Ergänzungen bleiben', async () => {
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

  await t.test('set_catalog hängt an rb_sets, set_stamm ist fort', async () => {
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
