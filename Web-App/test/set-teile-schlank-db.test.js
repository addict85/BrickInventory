/**
 * Migration 0062: Die Setliste behält nur Set, Teil, Farbe, Menge und
 * Ersatzteil; Name, Kategorie, Farbe und Bild stehen in den Katalogen. Die View
 * set_parts_catalog zeigt den Lesestellen dieselben Spalten — und wie vorher
 * nur geprüfte Werte, keinen eingetippten Platzhalter eines Kontos.
 *
 * Die Migration läuft hier auf einem Altbestand in einem eigenen Schema
 * (search_path), damit die echte Datenbank unberührt bleibt.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  im View den Filter `CASE WHEN pc.name_von IS NULL …` weggelassen
 *      → rot: „ein Platzhalter erscheint nicht in der Setliste“
 *   B  in der Migration COALESCE(Katalog, Setliste) ohne Ersetzen des
 *      Platzhalters → rot: „der geprüfte Name aus der Setliste ersetzt den
 *      Platzhalter“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const MIGRATION = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '0062-set-teile-schlank.sql'), 'utf8');
const SCHEMA = `probe0062_${process.pid}`;

test('Migration 0062: schlanke Setliste', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  t.after(async () => {
    await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
    c.release();
    await db.pool.end().catch(() => {});
  });
  await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await c.query(`CREATE SCHEMA ${SCHEMA}`);
  await c.query(`SET search_path TO ${SCHEMA}, public`);
  // Der Altbestand: Kataloge wie heute, die Setliste in ihrer Form vor 0062.
  await c.query(`CREATE TABLE part_catalog (LIKE public.part_catalog INCLUDING ALL)`);
  await c.query(`CREATE TABLE part_color_catalog (LIKE public.part_color_catalog INCLUDING ALL)`);
  await c.query(`CREATE TABLE set_parts_catalog (
    set_number text NOT NULL, part_number text NOT NULL, part_name text, color_id integer NOT NULL,
    color_name text, color_hex text, category_name text, image_url text, image_local text,
    is_spare integer DEFAULT 0, quantity integer DEFAULT 1, updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT set_parts_catalog_pkey PRIMARY KEY (set_number, part_number, color_id))`);
  await c.query(`CREATE INDEX idx_spc_set ON set_parts_catalog (set_number)`);
  await c.query(`INSERT INTO set_parts_catalog VALUES
    ('75192-1', '3001', 'Brick 2 x 4', 4, 'Red', 'C91A09', 'Bricks', 'https://cdn.rebrickable.com/3001.jpg', '/images/parts/3001_4.jpg', 0, 6),
    ('75192-1', '3002', 'Brick 2 x 3', 1, 'Blue', '0055BF', 'Bricks', NULL, NULL, 1, 2)`);
  // Ein Konto hat 3001 vorher als Platzhalter eingetippt; 3002 steht geprüft da.
  await c.query(`INSERT INTO part_catalog (part_number, part_name, name_von) VALUES ('3001', 'Annas Stein', 42)`);
  await c.query(`INSERT INTO part_catalog (part_number, part_name) VALUES ('3002', 'Brick 2x3 geprüft')`);
  await c.query(MIGRATION);
  // Ein Platzhalter NACH der Migration, für die Frage, was die View zeigt.
  await c.query(`INSERT INTO part_catalog (part_number, part_name, name_von) VALUES ('3003', 'Brunos Stein', 43)`);
  await c.query(`INSERT INTO set_teile (set_number, part_number, color_id, quantity) VALUES ('75192-1', '3003', 0, 1)`);

  const zeile = async (nr) => (await c.query(`SELECT * FROM set_parts_catalog WHERE set_number = '75192-1' AND part_number = $1`, [nr])).rows[0];

  await t.test('die Setliste hat nur noch ihre eigenen Spalten', async () => {
    const spalten = (await c.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'set_teile' ORDER BY column_name`, [SCHEMA])).rows.map(r => r.column_name);
    assert.deepEqual(spalten, ['color_id', 'is_spare', 'part_number', 'quantity', 'set_number', 'updated_at']);
  });

  await t.test('die View zeigt dieselben Werte wie vorher', async () => {
    const z = await zeile('3001');
    assert.equal(z.color_name, 'Red');
    assert.equal(z.color_hex, 'C91A09');
    assert.equal(z.category_name, 'Bricks');
    assert.equal(z.image_url, 'https://cdn.rebrickable.com/3001.jpg');
    assert.equal(z.image_local, '/images/parts/3001_4.jpg');
    assert.equal(z.quantity, 6);
    assert.equal((await zeile('3002')).is_spare, 1);
  });

  await t.test('der geprüfte Name aus der Setliste ersetzt den Platzhalter', async () => {
    assert.equal((await zeile('3001')).part_name, 'Brick 2 x 4');
    const k = (await c.query(`SELECT part_name, name_von FROM part_catalog WHERE part_number = '3001'`)).rows[0];
    assert.deepEqual(k, { part_name: 'Brick 2 x 4', name_von: null });
  });

  await t.test('ein vorhandener geprüfter Wert bleibt', async () => {
    assert.equal((await zeile('3002')).part_name, 'Brick 2x3 geprüft');
  });

  await t.test('ein Platzhalter erscheint nicht in der Setliste', async () => {
    assert.equal((await zeile('3003')).part_name, null);
  });
});
