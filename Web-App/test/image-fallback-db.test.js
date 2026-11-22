/**
 * Image address: fallback to the shared catalog — against a real database.
 *
 * If the image address is missing in the own sets row (download deadline, CSV import,
 * barcode), it comes from the cross-account set_catalog. Without the
 * fallback the API delivered image_url: null, and both clients showed the
 * placeholder although the CDN address was known; they choose the proxy themselves.
 *
 * Counter-check (performed): COALESCE turned back to s.image_url →
 * the first substep here turns red.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without DB: skip.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { holdsSet, catalogSet } = require('./helpers/inventory');

test('if the image address is missing on the set, it comes from the shared catalog', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;

  const USERNAME = 'img-fallback-test';
  const OHNE = '60445-1'; // image only in the catalog
  const MIT = '60446-1'; // own address present
  const CDN = 'https://cdn.rebrickable.com/media/sets/60445-1.jpg';
  const OWN = 'https://cdn.rebrickable.com/media/sets/eigen.jpg';

  await db.run(`DELETE FROM users WHERE username=$1`, [USERNAME]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [USERNAME]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [USERNAME])).id;

  await db.run(`DELETE FROM sets WHERE set_number = ANY($1)`, [[OHNE, MIT]]);
  await db.run(`DELETE FROM set_catalog WHERE set_number = ANY($1)`, [[OHNE, MIT]]);

  // What migration 0033 changed in this setup
  await holdsSet(db, uid, OHNE, 1);
  await catalogSet(db, OHNE, { name: 'F1 Truck', image_url: CDN });

  // Counterpart: a DIFFERENT address in the catalog — it must get through unchanged.
  await holdsSet(db, uid, MIT, 1);
  await catalogSet(db, MIT, { name: 'Anderes', image_url: OWN });

  try {
    const { readSets } = require('./helpers/sources').handlerModule(_req);
    const r = await readSets([uid], {});
    const ohne = r.sets.find(s => s.set_number === OHNE);
    const mit = r.sets.find(s => s.set_number === MIT);

    assert.ok(ohne, 'das Set ohne eigene Bildadresse muss in der Liste sein');
    assert.equal(ohne.image_local, null, 'Vorbedingung: keine lokale Datei');
    assert.equal(
      ohne.image_url,
      CDN,
      'ohne eigene Adresse muss die CDN-Adresse aus dem gemeinsamen Katalog kommen — ' +
        'sonst haben beide Clients nichts anzuzeigen',
    );

    assert.equal(
      mit.image_url,
      OWN,
      'eine vorhandene eigene Adresse hat Vorrang und wird NICHT vom Katalog überschrieben',
    );
  } finally {
    await db.run(`DELETE FROM users WHERE username=$1`, [USERNAME]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number = ANY($1)`, [[OHNE, MIT]]).catch(() => {});
    await db.run(`DELETE FROM set_catalog WHERE set_number = ANY($1)`, [[OHNE, MIT]]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
