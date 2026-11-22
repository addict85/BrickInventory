/**
 * The image folder applies to all accounts: what lies there under a part or
 * set number is seen by all. Hence the server only fetches images from
 * addresses in the catalog that come from a verified source — never from one
 * a client sends along or typed in.
 *
 * Counter-checks (measured on 30.10.2026):
 *   A  imagesFromCatalog() no longer resets the client's image_url/image_local
 *      → red: “the client's local path stays” and
 *      “the client's image address is fetched”
 *   B  (03.11.2026) teilbilder() additionally reads part_color_custom → red:
 *      “a typed-in address is stored for everyone”
 *   C  setNumberFromImageAddress() again with the old, unanchored
 *      pattern on the whole address → red: “…?/media/sets/10294-1.jpg yields
 *      a set number”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
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

/** Intercept https.get: every address is noted and answered with 404. */
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

test('image sources come from the catalog, not from the client', { concurrency: 1 }, async t => {
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

  // Verified address in the catalog, typed-in one in an account's own details.
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

  await t.test("the client's details are discarded", async () => {
    const parts = fromClient();
    await imagesFromCatalog(parts);
    assert.equal(parts[0].image_url, GUT);
    assert.equal(parts[0].image_local, null, 'der lokale Pfad des Clients bleibt stehen');
    assert.equal(parts[1].image_url, null, 'eine eingetippte Adresse wird für alle abgelegt');
    assert.equal(parts[2].image_url, null, 'ohne Katalogzeile bleibt die Adresse des Clients');
    assert.equal(parts[2].image_local, null);
  });

  await t.test('only the verified catalog address is fetched', async () => {
    const abgerufen = intercept(t);
    await createPdf({ job_id: jobId, user_id: 1, sets: [], parts: fromClient() });
    assert.ok(abgerufen.includes(GUT), `die Katalogadresse wird nicht abgerufen: ${abgerufen}`);
    assert.ok(!abgerufen.includes(BOESE), 'die Bildadresse des Clients wird abgerufen');
    assert.ok(!abgerufen.includes(TAPPED), 'eine eingetippte Adresse wird für alle abgelegt');
  });
});

test('set number only from a plain Rebrickable set address', () => {
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
