/**
 * Bildadresse: Rückfall auf den gemeinsamen Katalog — gegen echte Datenbank.
 *
 * Fehlt die Bildadresse in der eigenen sets-Zeile (Download-Frist, CSV-Import,
 * Barcode), kommt sie aus dem kontoübergreifenden set_catalog. Ohne den
 * Rückfall lieferte die API image_url: null, und beide Clients zeigten den
 * Platzhalter, obwohl die CDN-Adresse bekannt war; den Proxy wählen sie selbst.
 *
 * Gegenprobe (durchgeführt): COALESCE wieder auf s.image_url zurückgedreht →
 * der erste Teilschritt hier wird rot.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');
const { haeltSet, katalogSet } = require('./helpers/bestand');

test('fehlt die Bildadresse am Set, kommt sie aus dem gemeinsamen Katalog',
  { concurrency: 1 }, async (t) => {

  if (!await dbOderSkip(t, _req, { migrieren: false })) return;

  const USERNAME = 'img-fallback-test';
  const OHNE = '60445-1';   // Bild nur im Katalog
  const MIT  = '60446-1';   // eigene Adresse vorhanden
  const CDN  = 'https://cdn.rebrickable.com/media/sets/60445-1.jpg';
  const EIGEN = 'https://cdn.rebrickable.com/media/sets/eigen.jpg';

  await db.run(`DELETE FROM users WHERE username=$1`, [USERNAME]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [USERNAME]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [USERNAME])).id;

  await db.run(`DELETE FROM sets WHERE set_number = ANY($1)`, [[OHNE, MIT]]);
  await db.run(`DELETE FROM set_catalog WHERE set_number = ANY($1)`, [[OHNE, MIT]]);

  // Was Migration 0033 an diesem Aufbau geaendert hat
  // Ausführlich: docs/begruendungen/test/image-fallback-db.test.js.md#stelle
  await haeltSet(db, uid, OHNE, 1);
  await katalogSet(db, OHNE, { name: 'F1 Truck', image_url: CDN });

  // Gegenstück: eine ANDERE Adresse im Katalog — sie muss unveraendert
  // durchkommen. Vorher stand sie an der sets-Zeile ($1 = EIGEN).
  await haeltSet(db, uid, MIT, 1);
  await katalogSet(db, MIT, { name: 'Anderes', image_url: EIGEN });

  try {
    const { getSets } = require('./helpers/sources').handlerModul(_req);
    const r = await getSets([uid], {});
    const ohne = r.sets.find(s => s.set_number === OHNE);
    const mit  = r.sets.find(s => s.set_number === MIT);

    assert.ok(ohne, 'das Set ohne eigene Bildadresse muss in der Liste sein');
    assert.equal(ohne.image_local, null, 'Vorbedingung: keine lokale Datei');
    assert.equal(ohne.image_url, CDN,
      'ohne eigene Adresse muss die CDN-Adresse aus dem gemeinsamen Katalog kommen — ' +
      'sonst haben beide Clients nichts anzuzeigen');

    assert.equal(mit.image_url, EIGEN,
      'eine vorhandene eigene Adresse hat Vorrang und wird NICHT vom Katalog überschrieben');
  } finally {
    await db.run(`DELETE FROM users WHERE username=$1`, [USERNAME]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number = ANY($1)`, [[OHNE, MIT]]).catch(() => {});
    await db.run(`DELETE FROM set_catalog WHERE set_number = ANY($1)`, [[OHNE, MIT]]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
