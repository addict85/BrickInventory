/**
 * Der Bildordner gilt für alle Konten: Was dort unter einer Teile- oder
 * Setnummer liegt, sehen alle. Deshalb holt der Server Bilder nur von
 * Adressen aus dem Katalog, die aus geprüfter Quelle stammen — nie von einer,
 * die ein Client mitschickt oder eingetippt hat.
 *
 * Geprüft am PDF-Auftrag (jobs/pdfErzeugung.ts) mit abgefangenem https.get:
 * Welche Adressen werden wirklich abgerufen? Und am Bild-Proxy: Welche
 * Adresse ergibt eine Setnummer?
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  bilderAusKatalog() setzt image_url/image_local des Clients nicht mehr
 *      zurück → rot: „der lokale Pfad des Clients bleibt stehen“ und
 *      „die Bildadresse des Clients wird abgerufen“
 *   B  in bilderAusKatalog() `CASE WHEN bild_von IS NULL` entfernt → rot:
 *      „eine eingetippte Adresse wird für alle abgelegt“
 *   C  setNummerAusBildAdresse() wieder mit dem alten, nicht verankerten
 *      Muster auf der ganzen Adresse → rot: „…?/media/sets/10294-1.jpg ergibt
 *      eine Setnummer“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const https  = require('node:https');
const { EventEmitter } = require('node:events');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

const T = `bq${process.pid}`;
const GUT = `https://cdn.rebrickable.com/media/parts/${T}-gut.jpg`;
const BOESE = `https://cdn.rebrickable.com/media/parts/${T}-BOESE.jpg`;
const GETIPPT = `https://cdn.rebrickable.com/media/parts/${T}-getippt.jpg`;

/** https.get abfangen: Jede Adresse wird notiert und mit 404 beantwortet. */
function abfangen(t) {
  const echt = https.get;
  const abgerufen = [];
  https.get = (url, _opt, cb) => {
    abgerufen.push(String(url));
    const req = new EventEmitter();
    req.setTimeout = () => req; req.destroy = () => {};
    setImmediate(() => { const r = new EventEmitter(); r.statusCode = 404; r.headers = {}; r.resume = () => {}; cb(r); });
    return req;
  };
  t.after(() => { https.get = echt; });
  return abgerufen;
}

test('Bildquellen kommen aus dem Katalog, nicht vom Client', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  { const c = await db.pool.connect(); try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); } }
  const { neueJobId, pdfDateiPfad } = _req('src/auftraege/pdfAuftraege.js');
  const jobId = neueJobId();
  const aufraeumen = async () => {
    await db.run('DELETE FROM part_color_catalog WHERE part_number LIKE $1', [`${T}%`]);
    await db.run('DELETE FROM auftraege WHERE schluessel = $1', [`pdf:${jobId}`]);
    require('node:fs').rmSync(pdfDateiPfad(jobId), { force: true });
  };
  await aufraeumen();
  t.after(async () => { await aufraeumen(); await db.pool.end().catch(() => {}); });

  // Geprüfte Adresse (bild_von NULL), eingetippte eines Kontos (bild_von 4711).
  await db.run(`INSERT INTO part_color_catalog (part_number, color_id, image_url) VALUES ($1, 5, $2)`, [`${T}a`, GUT]);
  await db.run(`INSERT INTO part_color_catalog (part_number, color_id, image_url, bild_von) VALUES ($1, 5, $2, 4711)`,
    [`${T}b`, GETIPPT]);

  const { bilderAusKatalog, erzeugePdf } = _req('jobs/pdfErzeugung.js');
  const vomClient = () => [
    { part_number: `${T}a`, color_id: 5, quantity: 1, image_url: BOESE, image_local: '/images/parts/fremd.jpg' },
    { part_number: `${T}b`, color_id: 5, quantity: 1, image_url: BOESE },
    { part_number: `${T}c`, color_id: 5, quantity: 1, image_url: BOESE, image_local: '/images/parts/fremd.jpg' },
    { part_number: `${T}d`, color_id: 5, quantity: 1, image_url: BOESE },
  ];

  await t.test('die Angaben des Clients werden verworfen', async () => {
    const teile = vomClient();
    await bilderAusKatalog(teile);
    assert.equal(teile[0].image_url, GUT);
    assert.equal(teile[0].image_local, null, 'der lokale Pfad des Clients bleibt stehen');
    assert.equal(teile[1].image_url, null, 'eine eingetippte Adresse wird für alle abgelegt');
    assert.equal(teile[2].image_url, null, 'ohne Katalogzeile bleibt die Adresse des Clients');
    assert.equal(teile[2].image_local, null);
  });

  await t.test('abgerufen wird nur die geprüfte Katalogadresse', async () => {
    const abgerufen = abfangen(t);
    await erzeugePdf({ job_id: jobId, user_id: 1, sets: [], parts: vomClient() });
    assert.ok(abgerufen.includes(GUT), `die Katalogadresse wird nicht abgerufen: ${abgerufen}`);
    assert.ok(!abgerufen.includes(BOESE), 'die Bildadresse des Clients wird abgerufen');
    assert.ok(!abgerufen.includes(GETIPPT), 'eine eingetippte Adresse wird für alle abgelegt');
  });
});

test('Setnummer nur aus einer reinen Rebrickable-Setadresse', () => {
  const { setNummerAusBildAdresse: sn } = _req('routes/imgProxy.js');
  assert.equal(sn('https://cdn.rebrickable.com/media/sets/10294-1.jpg'), '10294-1');
  for (const fremd of [
    'https://cdn.rebrickable.com/media/parts/x.png?/media/sets/10294-1.jpg',
    'https://cdn.rebrickable.com/media/parts/x.png#/media/sets/10294-1.jpg',
    'https://cdn.rebrickable.com/media/thumbs/media/sets/10294-1.jpg',
    'https://images.brickset.com/media/sets/10294-1.jpg',
    'https://cdn.rebrickable.com/media/sets/...jpg',
  ]) assert.equal(sn(fremd), null, `${fremd} ergibt eine Setnummer`);
});
