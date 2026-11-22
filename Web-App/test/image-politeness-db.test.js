/**
 * Gentle handling of the image server.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { emptyQueue } = require('./helpers/image-queue');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// Record times and concurrency of the downloads.
const times = [];
const thumbTimes = [];
let gleichzeitig = 0,
  maxConcurrent = 0;

const { buildAndRequire, testData, testImageWorker } = require('./helpers/sources');
const _req = buildAndRequire();
testImageWorker(null, {
  loadSetImage: async (_u, sn) => {
    times.push(Date.now());
    gleichzeitig++;
    maxConcurrent = Math.max(maxConcurrent, gleichzeitig);
    await new Promise(r => setTimeout(r, 30)); // “network"
    gleichzeitig--;
    return `/images/sets/${sn}.jpg`;
  },
  createPreview: async () => {
    thumbTimes.push(Date.now());
    return true;
  },
});
const { keineDb } = require('./helpers/db');
const db = testData();

test('the image server is queried gently', { concurrency: 1 }, async t => {
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  // The queue must be emptied BEFORE use, not only the own
  // prefix — otherwise the batch takes the rows of a predecessor. Rationale
  // and reproduction in helpers/image-queue.js.
  await emptyQueue(db);

  const P = `TK${process.pid}`;
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
  await db.run(
    `INSERT INTO image_wanted (url, set_number)
                SELECT 'https://cdn/'||$1||'_'||g||'.jpg', $1||'_'||g
                  FROM generate_series(1,10) g`,
    [P],
  );

  try {
    const n = (await _req('src/images/imageDemandRun.js')._workStack()).total;
    const spacing = times.slice(1).map((z, i) => z - times[i]);

    await t.test('one after another, never concurrently', () => {
      assert.equal(
        maxConcurrent,
        1,
        `${maxConcurrent} Downloads liefen gleichzeitig — gefordert ist ` +
          'sequenziell, gerade weil Parallelität einer Heuristik auffällt',
      );
    });

    await t.test('at least half a second apart', () => {
      assert.ok(spacing.length >= 5, `nur ${spacing.length} Abstände gemessen`);
      const smallest = Math.min(...spacing);
      assert.ok(smallest >= 500, `kleinster Abstand ${smallest} ms — gefordert sind mindestens 500`);
    });

    await t.test('the intervals are not all the same', () => {
      // An exactly equal spacing is itself a pattern: a heuristic that
      // looks for machines recognizes evenness more easily than irregularity.
      const only = new Set(spacing.map(a => Math.round(a / 50)));
      assert.ok(only.size > 1, 'Alle Abstände sind gleich — die Verzögerung muss zufällig streuen');
    });

    await t.test('at most 30 requests per minute', () => {
      // The rate results from batch size and tick; both come from the
      // module so that the test repeats no number that may change.
      const { BATCH: stapel, TICK_MS: takt } = _req('src/images/imageDemandRun.js');
      assert.ok(stapel > 0 && takt > 0, 'STAPEL oder TAKT_MS nicht auffindbar');
      const jeMinute = stapel * (60_000 / takt);
      assert.ok(jeMinute <= 30, `${jeMinute} Anfragen je Minute — höchstens 30 sind gewollt`);
      assert.equal(n, stapel, `${n} Bilder in einem Durchgang statt ${stapel}`);
    });
  } finally {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
    // Do not close the pool — the test below still needs it. Cleanup happens
    // in the LAST test of this file that works with the database.
  }
});

test('pure preview work is throttled too', { concurrency: 1 }, async t => {
  // Marco's log
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  // The queue must be emptied BEFORE use, not only the own
  // prefix — otherwise the batch takes the rows of a predecessor. Rationale
  // and reproduction in helpers/image-queue.js.
  await emptyQueue(db);
  const { SET_IMAGES_DIR } = _req('src/infra/appPaths.js');
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });
  const P = `NT${process.pid}`;
  const dateien = [];
  // Images present, previews missing — Marco's situation.
  for (let i = 1; i <= 10; i++) {
    const f = path.join(SET_IMAGES_DIR, `${P}_${i}.jpg`);
    fs.writeFileSync(f, 'x');
    dateien.push(f);
  }
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
  await db.run(
    `INSERT INTO image_wanted (url, set_number)
                SELECT 'https://cdn/'||$1||'_'||g||'.jpg', $1||'_'||g
                  FROM generate_series(1,10) g`,
    [P],
  );
  thumbTimes.length = 0;
  try {
    const n = (await _req('src/images/imageDemandRun.js')._workStack()).total;
    assert.equal(n, 10, `${n} Vorschauen statt 10 — Vorbedingung stimmt nicht`);
    const abst = thumbTimes.slice(1).map((z, i) => z - thumbTimes[i]);
    assert.ok(abst.length >= 5, `nur ${abst.length} Abstände`);
    const smallest = Math.min(...abst);
    assert.ok(
      smallest >= 500,
      `kleinster Abstand zwischen zwei Verkleinerungen: ${smallest} ms. Ohne ` +
        'Pause rechnet der Job zehn davon am Stück — auf schwacher Hardware ist ' +
        'die CPU dann belegt, und Datenbankabfragen laufen in den Zeitfehler.',
    );
  } finally {
    for (const f of dateien) fs.rmSync(f, { force: true });
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
    // Last test with database in this file — cleanup happens here.
    await db.pool.end().catch(() => {});
  }
});

// Counter-check (09.11.2026): bildUserAgent() back to `BrickInventoryManager/…` → red
// “the image job fetches with the proxy's browser identifier”.
test("the image job fetches with the proxy's browser identifier", () => {
  const dist = path.join(ROOT, 'dist', 'src/images/setImages.js');
  assert.ok(fs.existsSync(dist), 'dist/src/images/setImages.js fehlt — erst bauen');
  const { IMAGE_HEADERS } = require(path.join(ROOT, 'dist', 'clients/imageCdn.js'));
  const ua = require(dist).imageUserAgent({ bildUserAgent: null });
  assert.equal(ua, IMAGE_HEADERS['User-Agent'], 'der Bild-Auftrag holt mit der Browser-Kennung des Proxys');
  assert.match(ua, /^Mozilla\/5\.0 /);
});
