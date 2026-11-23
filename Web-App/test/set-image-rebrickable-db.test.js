/**
 * Set images come from Rebrickable: only for these addresses does the image proxy store
 * the image including preview under images/sets. The fallback when creating and
 * migration 0101 for the inventory both lead to the fixed CDN address.
 * The migration runs in its own schema (search_path).
 *
 * Counter-checks (measured 08.11.2026, each on its own):
 *   A  rebrickableSetImage() again on img.bricklink.com/ItemImage/SN/0/… →
 *      red: „der Proxy legt die Rückfall-Adresse lokal ab“
 *   B  the line for images.brickset.com deleted in 0101 → red:
 *      „BrickLink und Brickset zeigen danach auf Rebrickable“
 *   C  (15.11.2026, reversed) in setNumberFromImageAddress() the subfolder
 *      `(?:\/\d{1,12})?` allowed again → red: “only the main image …”
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
const { rebrickableSetImage } = _req('src/images/setImages.js');
const { setNumberFromImageAddress } = _req('src/images/http/imageProxy.js');
const MIGRATION = fs.readFileSync(
  path.join(__dirname, '..', 'db/migrations/0101-setbilder-von-rebrickable.sql'),
  'utf8',
);
const SCHEMA = `probe0101_${process.pid}`;

test('the proxy stores the fallback address locally', () => {
  const address = rebrickableSetImage('75192');
  assert.equal(address, 'https://cdn.rebrickable.com/media/sets/75192-1.jpg');
  assert.equal(setNumberFromImageAddress(address), '75192-1', 'the proxy stores the fallback address locally');
});

test('only the main image is stored locally, no additional image and nothing foreign', () => {
  for (const fremd of [
    'https://cdn.rebrickable.com/media/sets/75192-1/119389.jpg',
    'https://cdn.rebrickable.com/media/sets/75192-1.png',
    'https://cdn.rebrickable.com/media/parts/elements/300121.jpg',
    'https://cdn.rebrickable.com/media/sets/75192-1/119389.jpg?x=1',
    'https://img.bricklink.com/ItemImage/SN/0/75192-1.png',
  ])
    assert.equal(setNumberFromImageAddress(fremd), null, fremd);
});

test('migration 0101: set images from Rebrickable', { concurrency: 1 }, async t => {
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
  await c.query(`CREATE TABLE set_catalog (LIKE public.set_catalog INCLUDING ALL)`);
  await c.query(`INSERT INTO set_catalog (set_number, image_url, image_local) VALUES
    ('1-1', 'https://img.bricklink.com/ItemImage/SN/0/1-1.png', NULL),
    ('2-1', 'https://images.brickset.com/sets/images/2-1.jpg', NULL),
    ('3-1', 'https://cdn.rebrickable.com/media/sets/3-1/1234.jpg', NULL),
    ('4-1', 'https://img.bricklink.com/ItemImage/SN/0/4-1.png', '/images/sets/4-1.jpg'),
    ('5-1', NULL, NULL)`);
  await c.query(MIGRATION);

  const zeilen = (await c.query('SELECT set_number, image_url, image_local FROM set_catalog ORDER BY 1')).rows;
  assert.deepEqual(
    zeilen.slice(0, 2).map(z => z.image_url),
    ['https://cdn.rebrickable.com/media/sets/1-1.jpg', 'https://cdn.rebrickable.com/media/sets/2-1.jpg'],
    'BrickLink and Brickset point to Rebrickable afterwards',
  );
  assert.equal(
    zeilen[2].image_url,
    'https://cdn.rebrickable.com/media/sets/3-1/1234.jpg',
    'Rebrickable stays as it is',
  );
  assert.deepEqual(
    zeilen[3],
    {
      set_number: '4-1',
      image_url: 'https://cdn.rebrickable.com/media/sets/4-1.jpg',
      image_local: '/images/sets/4-1.jpg',
    },
    'a local image stays',
  );
  assert.equal(zeilen[4].image_url, null, 'without an address stays without an address');
});
