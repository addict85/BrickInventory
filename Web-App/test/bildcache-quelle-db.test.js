/**
 * Der Bildordner gilt für alle Konten: Was dort unter einer Teile- oder
 * Setnummer liegt, sehen alle. Deshalb holt der Server Bilder nur von
 * Adressen aus dem Katalog, die aus geprüfter Quelle stammen — nie von einer,
 * die ein Client mitschickt oder eingetippt hat.
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  imagesFromCatalog() setzt image_url/image_local des Clients nicht mehr
 *      zurück → rot: „der lokale Pfad des Clients bleibt stehen“ und
 *      „die Bildadresse des Clients wird abgerufen“
 *   B  (03.11.2026) teilbilder() liest zusätzlich part_color_custom → rot:
 *      „eine eingetippte Adresse wird für alle abgelegt“
 *   C  setNumberFromImageAddress() wieder mit dem alten, nicht verankerten
 *      Muster auf der ganzen Adresse → rot: „…?/media/sets/10294-1.jpg ergibt
 *      eine Setnummer“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testData();

const T = `bq${process.pid}`;
const GUT = `https://cdn.rebrickable.com/media/parts/${T}-gut.jpg`;
const BOESE = `https://cdn.rebrickable.com/media/parts/${T}-BOESE.jpg`;
const TAPPED = `https://cdn.rebrickable.com/media/parts/${T}-getippt.jpg`;

/** https.get abfangen: Jede Adresse wird notiert und mit 404 beantwortet. */
function intercept(t) {
  const echt = https.get;
  const abgerufen = [];
  /** @type {any} */ (https).get = (url, _opt, cb) => {
    abgerufen.push(String(url));
    const req = /** @type {any} */ (new EventEmitter());
    req.setTimeout = () => req;
    req.destroy = () => {};
    setImmediate(() => {
      const r = /** @type {any} */ (new EventEmitter());
      r.statusCode = 404;
      r.headers = {};
      r.resume = () => {};
      cb(r);
    });
    return req;
  };
  t.after(() => {
    https.get = echt;
  });
  return abgerufen;
}

test('Bildquellen kommen aus dem Katalog, nicht vom Client', { concurrency: 1 }, async t => {
  try {
    await db.initSchema();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }
  const { newJobId, pdfFilePath } = _req('src/catalog/pdf/pdfJobs.js');
  const jobId = newJobId(Date.now());
  const aufraeumen = async () => {
    await db.run('DELETE FROM part_color_catalog WHERE part_number LIKE $1', [`${T}%`]);
    await db.run('DELETE FROM users WHERE username = $1', [T]);
    await db.run('DELETE FROM jobs WHERE dedupe_key = $1', [`pdf:${jobId}`]);
    require('node:fs').rmSync(pdfFilePath(jobId), { force: true });
  };
  await aufraeumen();
  t.after(async () => {
    await aufraeumen();
    await db.pool.end().catch(() => {});
  });

  // Geprüfte Adresse im Katalog, eingetippte in den eigenen Angaben eines Kontos.
  await db.run(`INSERT INTO part_color_catalog (part_number, color_id, image_url) VALUES ($1, 5, $2)`, [`${T}a`, GUT]);
  const konto = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [T])).id;
  await db.run(`INSERT INTO part_color_custom (user_id, part_number, color_id, image_url) VALUES ($1, $2, 5, $3)`, [
    konto,
    `${T}b`,
    TAPPED,
  ]);

  const { imagesFromCatalog, createPdf } = _req('src/catalog/pdf/pdfGeneration.js');
  const fromClient = () => [
    { part_number: `${T}a`, color_id: 5, quantity: 1, image_url: BOESE, image_local: '/images/parts/fremd.jpg' },
    { part_number: `${T}b`, color_id: 5, quantity: 1, image_url: BOESE },
    { part_number: `${T}c`, color_id: 5, quantity: 1, image_url: BOESE, image_local: '/images/parts/fremd.jpg' },
    { part_number: `${T}d`, color_id: 5, quantity: 1, image_url: BOESE },
  ];

  await t.test('die Angaben des Clients werden verworfen', async () => {
    const teile = fromClient();
    await imagesFromCatalog(teile);
    assert.equal(teile[0].image_url, GUT);
    assert.equal(teile[0].image_local, null, 'der lokale Pfad des Clients bleibt stehen');
    assert.equal(teile[1].image_url, null, 'eine eingetippte Adresse wird für alle abgelegt');
    assert.equal(teile[2].image_url, null, 'ohne Katalogzeile bleibt die Adresse des Clients');
    assert.equal(teile[2].image_local, null);
  });

  await t.test('abgerufen wird nur die geprüfte Katalogadresse', async () => {
    const abgerufen = intercept(t);
    await createPdf({ job_id: jobId, user_id: 1, sets: [], parts: fromClient() });
    assert.ok(abgerufen.includes(GUT), `die Katalogadresse wird nicht abgerufen: ${abgerufen}`);
    assert.ok(!abgerufen.includes(BOESE), 'die Bildadresse des Clients wird abgerufen');
    assert.ok(!abgerufen.includes(TAPPED), 'eine eingetippte Adresse wird für alle abgelegt');
  });
});

test('Setnummer nur aus einer reinen Rebrickable-Setadresse', () => {
  const { setNumberFromImageAddress: sn } = _req('routes/imgProxy.js');
  assert.equal(sn('https://cdn.rebrickable.com/media/sets/10294-1.jpg'), '10294-1');
  for (const fremd of [
    'https://cdn.rebrickable.com/media/parts/x.png?/media/sets/10294-1.jpg',
    'https://cdn.rebrickable.com/media/parts/x.png#/media/sets/10294-1.jpg',
    'https://cdn.rebrickable.com/media/thumbs/media/sets/10294-1.jpg',
    'https://images.brickset.com/media/sets/10294-1.jpg',
    'https://cdn.rebrickable.com/media/sets/...jpg',
  ])
    assert.equal(sn(fremd), null, `${fremd} ergibt eine Setnummer`);
});
