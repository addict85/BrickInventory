/**
 * Bildadresse: Rückfall auf den gemeinsamen Katalog — gegen echte Datenbank.
 *
 * ── Woher dieser Test kommt (Marcos Bericht, Nachtrag 36) ───────────────────
 * Symptom: Bei einem neu erfassten Set wurde das Bild NIRGENDS angezeigt —
 * weder in der Android-App noch in der Webapp, weder in der Liste noch in der
 * Detailansicht. Marcos Erwartung, wörtlich: „Wenn das Bild lokal noch nicht
 * vorhanden ist, soll dieses direkt via Proxy vom CDN geholt und angezeigt
 * werden."
 *
 * Ursache: Die Liste las die Bildadresse ausschliesslich aus der EIGENEN
 * sets-Zeile. Steht dort nichts — der Download beim Erfassen lief in seine
 * 15-Sekunden-Frist, das Set kam über CSV-Import oder Barcode-Scan, oder eine
 * ältere Zeile hat das Feld nie gefüllt —, lieferte die API image_url: null
 * UND image_local: null. Beide Clients hatten damit nichts in der Hand und
 * zeigten den Platzhalter, obwohl die CDN-Adresse im set_catalog längst
 * bekannt war.
 *
 * set_catalog wird beim Erfassen jedes Sets gefüllt und ist kontoübergreifend
 * — der Rückfall greift deshalb auch für Sets, die ein anderes
 * Haushaltsmitglied zuerst erfasst hat. Die Auflösung zum Proxy machen die
 * Clients danach von selbst (imgUrl() in der Webapp, resolveThumbUrl() in der
 * App); beide brauchen dafür nur eine nicht-leere Adresse.
 *
 * Gegenprobe (durchgeführt): COALESCE wieder auf s.image_url zurückgedreht →
 * der erste Teilschritt hier wird rot.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

test('fehlt die Bildadresse am Set, kommt sie aus dem gemeinsamen Katalog',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

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

  // Der beobachtete Zustand: Zeile ohne jede Bildangabe.
  await db.run(`INSERT INTO sets (user_id,set_number,name,quantity) VALUES ($1,$2,'F1 Truck',1)`, [uid, OHNE]);
  await db.run(`INSERT INTO set_catalog (set_number,name,image_url) VALUES ($1,'F1 Truck',$2)
                ON CONFLICT (set_number) DO UPDATE SET image_url=EXCLUDED.image_url`, [OHNE, CDN]);

  // Gegenstück: eigene Adresse vorhanden — sie darf NICHT überschrieben werden.
  await db.run(`INSERT INTO sets (user_id,set_number,name,quantity,image_url) VALUES ($1,$2,'Anderes',1,$3)`, [uid, MIT, EIGEN]);
  await db.run(`INSERT INTO set_catalog (set_number,name,image_url) VALUES ($1,'Anderes','https://cdn.rebrickable.com/media/sets/katalog.jpg')
                ON CONFLICT (set_number) DO UPDATE SET image_url=EXCLUDED.image_url`, [MIT]);

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
