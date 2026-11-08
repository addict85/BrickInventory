/**
 * Set-Bilder kommen von Rebrickable: Nur für diese Adressen legt der Bild-Proxy
 * das Bild samt Vorschau unter images/sets ab. Der Rückfall beim Anlegen und
 * Migration 0101 für den Bestand führen beide auf die feste CDN-Adresse.
 * Die Migration läuft in einem eigenen Schema (search_path).
 *
 * Gegenproben (08.11.2026 gemessen, je einzeln):
 *   A  rebrickableSetBild() wieder auf img.bricklink.com/ItemImage/SN/0/… →
 *      rot: „der Proxy legt die Rückfall-Adresse lokal ab“
 *   B  in 0101 die Zeile für images.brickset.com gestrichen → rot:
 *      „BrickLink und Brickset zeigen danach auf Rebrickable“
 *   C  in setNummerAusBildAdresse() den Unterordner `(?:\/\d{1,12})?` gestrichen
 *      → rot: „auch die Adresse mit Bild-Nummer wird lokal abgelegt“
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
const { rebrickableSetBild } = _req('src/katalog/bilder/setImages.js');
const { setNummerAusBildAdresse } = _req('src/katalog/http/bildProxy.js');
const MIGRATION = fs.readFileSync(path.join(__dirname, '..', 'db/migrations/0101-setbilder-von-rebrickable.sql'), 'utf8');
const SCHEMA = `probe0101_${process.pid}`;

test('der Proxy legt die Rückfall-Adresse lokal ab', () => {
  const adresse = rebrickableSetBild('75192');
  assert.equal(adresse, 'https://cdn.rebrickable.com/media/sets/75192-1.jpg');
  assert.equal(setNummerAusBildAdresse(adresse), '75192-1', 'der Proxy legt die Rückfall-Adresse lokal ab');
});

test('auch die Adresse mit Bild-Nummer wird lokal abgelegt, fremde nicht', () => {
  assert.equal(setNummerAusBildAdresse('https://cdn.rebrickable.com/media/sets/75192-1/119389.jpg'), '75192-1',
    'auch die Adresse mit Bild-Nummer wird lokal abgelegt');
  for (const fremd of [
    'https://cdn.rebrickable.com/media/parts/elements/300121.jpg',
    'https://cdn.rebrickable.com/media/sets/75192-1/119389.jpg?x=1',
    'https://img.bricklink.com/ItemImage/SN/0/75192-1.png',
  ]) assert.equal(setNummerAusBildAdresse(fremd), null, fremd);
});

test('Migration 0101: Set-Bilder von Rebrickable', { concurrency: 1 }, async (t) => {
  if (!await dbOderSkip(t, _req, { migrieren: false })) return;
  const c = await db.pool.connect();
  t.after(async () => {
    await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
    c.release();
    await db.pool.end().catch(() => {});
  });
  await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await c.query(`CREATE SCHEMA ${SCHEMA}`);
  await c.query(`SET search_path TO ${SCHEMA}, public`);
  await c.query(`CREATE TABLE set_catalog (LIKE public.set_catalog INCLUDING ALL)`);
  await c.query(`INSERT INTO set_catalog (set_number, image_url, image_local) VALUES
    ('1-1', 'https://img.bricklink.com/ItemImage/SN/0/1-1.png', NULL),
    ('2-1', 'https://images.brickset.com/sets/images/2-1.jpg', NULL),
    ('3-1', 'https://cdn.rebrickable.com/media/sets/3-1/1234.jpg', NULL),
    ('4-1', 'https://img.bricklink.com/ItemImage/SN/0/4-1.png', '/images/sets/4-1.jpg'),
    ('5-1', NULL, NULL)`);
  await c.query(MIGRATION);

  const zeilen = (await c.query('SELECT set_number, image_url, image_local FROM set_catalog ORDER BY 1')).rows;
  assert.deepEqual(zeilen.slice(0, 2).map(z => z.image_url), [
    'https://cdn.rebrickable.com/media/sets/1-1.jpg',
    'https://cdn.rebrickable.com/media/sets/2-1.jpg',
  ], 'BrickLink und Brickset zeigen danach auf Rebrickable');
  assert.equal(zeilen[2].image_url, 'https://cdn.rebrickable.com/media/sets/3-1/1234.jpg', 'Rebrickable bleibt, wie es ist');
  assert.deepEqual(zeilen[3], { set_number: '4-1', image_url: 'https://cdn.rebrickable.com/media/sets/4-1.jpg',
    image_local: '/images/sets/4-1.jpg' }, 'ein lokales Bild bleibt liegen');
  assert.equal(zeilen[4].image_url, null, 'ohne Adresse bleibt ohne Adresse');
});
