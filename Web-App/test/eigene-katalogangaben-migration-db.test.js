/**
 * Migration 0093: Eingetippte Katalogwerte ziehen aus dem gemeinsamen
 * Katalog zu ihrem Konto um; geprüfte Werte bleiben, Eingaben gelöschter
 * Konten entfallen. Läuft auf einem Altbestand in einem eigenen Schema
 * (search_path), die echte Datenbank bleibt unberührt.
 *
 * Gegenproben (am 03.11.2026 gemessen):
 *   A  das UPDATE auf part_catalog weggelassen → rot: „der gemeinsame Katalog
 *      behält nur Geprüftes“ (die Spalte fällt, der fremde Name bliebe stehen)
 *   B  für teil_eigen alle `*_von`-Werte statt nur bestehender Konten → rot:
 *      Fremdschlüssel teil_eigen_user_id_fkey verletzt (Konto 2147480000)
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
const MIGRATION = fs.readFileSync(path.join(__dirname, '..', 'db/migrations/0093-eigene-katalogangaben.sql'), 'utf8');
const SCHEMA = `probe0093_${process.pid}`;

test('Migration 0093: eigene Katalogangaben', { concurrency: 1 }, async (t) => {
  if (!await dbOderSkip(t, _req, { migrieren: false })) return;
  const c = await db.pool.connect();
  t.after(async () => {
    await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
    await c.query(`DELETE FROM public.users WHERE username = $1`, [SCHEMA]).catch(() => {});
    c.release();
    await db.pool.end().catch(() => {});
  });
  await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await c.query(`CREATE SCHEMA ${SCHEMA}`);
  await c.query(`SET search_path TO ${SCHEMA}, public`);
  for (const tab of ['part_catalog', 'part_color_catalog', 'minifigs_catalog', 'set_teile', 'set_figuren'])
    await c.query(`CREATE TABLE ${tab} (LIKE public.${tab} INCLUDING ALL)`);
  await c.query(`ALTER TABLE part_catalog ADD COLUMN name_von integer, ADD COLUMN kategorie_von integer`);
  await c.query(`ALTER TABLE part_color_catalog ADD COLUMN farbname_von integer, ADD COLUMN farbcode_von integer, ADD COLUMN bild_von integer`);
  await c.query(`ALTER TABLE minifigs_catalog ADD COLUMN name_von integer, ADD COLUMN bild_von integer`);
  await c.query(`CREATE VIEW set_parts_catalog AS SELECT 1 AS x`);
  await c.query(`CREATE VIEW set_minifigs_catalog AS SELECT 1 AS x`);

  const anna = (await c.query(`INSERT INTO public.users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [SCHEMA])).rows[0].id;
  const weg = 2147480000;   // ein gelöschtes Konto
  await c.query(`INSERT INTO part_catalog (part_number, part_name, category_name, name_von, kategorie_von) VALUES
    ('p1', 'Annas Name', 'Brick', $1, NULL), ('p2', 'Geprüft', NULL, NULL, NULL), ('p3', 'Verwaist', NULL, $2, NULL)`, [anna, weg]);
  await c.query(`INSERT INTO part_color_catalog (part_number, color_id, color_name, color_hex, image_url, farbname_von, farbcode_von, bild_von)
    VALUES ('p1', 4, 'Tresorrot', 'AB1234', 'https://cdn.rebrickable.com/a.jpg', $1, NULL, $1)`, [anna]);
  await c.query(`INSERT INTO minifigs_catalog (fig_number, fig_name, image_url, name_von) VALUES ('f1', 'Geheimfigur', NULL, $1)`, [anna]);
  await c.query(MIGRATION);

  await t.test('Eingaben stehen beim Konto', async () => {
    assert.deepEqual((await c.query('SELECT user_id, part_number, part_name, category_name FROM teil_eigen')).rows,
      [{ user_id: anna, part_number: 'p1', part_name: 'Annas Name', category_name: null }]);
    assert.deepEqual((await c.query('SELECT user_id, color_name, color_hex, image_url FROM teil_farbe_eigen')).rows,
      [{ user_id: anna, color_name: 'Tresorrot', color_hex: null, image_url: 'https://cdn.rebrickable.com/a.jpg' }]);
    assert.deepEqual((await c.query('SELECT user_id, fig_name FROM figur_eigen')).rows, [{ user_id: anna, fig_name: 'Geheimfigur' }]);
  });

  await t.test('der gemeinsame Katalog behält nur Geprüftes', async () => {
    assert.deepEqual((await c.query('SELECT part_number, part_name, category_name FROM part_catalog ORDER BY 1')).rows, [
      { part_number: 'p1', part_name: null, category_name: 'Brick' },
      { part_number: 'p2', part_name: 'Geprüft', category_name: null },
      { part_number: 'p3', part_name: null, category_name: null },
    ]);
    assert.deepEqual((await c.query('SELECT color_name, color_hex, image_url FROM part_color_catalog')).rows,
      [{ color_name: null, color_hex: 'AB1234', image_url: null }]);
    assert.equal((await c.query('SELECT fig_name FROM minifigs_catalog')).rows[0].fig_name, null);
  });
});
