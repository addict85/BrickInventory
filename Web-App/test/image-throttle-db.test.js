/**
 * A throttling of the CDN is NOT a miss marker.
 *
 * Counter-check: in src/images/imageDemandRun.ts the set-aside part of the message dropped → red “403 locks out no image and loses no note”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// Intercept the download and set the status code.
let response = 403;
const thumbAttempts = { n: 0 };
let versuche = 0;

const { buildAndRequire, testData, testImageWorker } = require('./helpers/sources');
const _req = buildAndRequire();
testImageWorker(null, {
  loadSetImage: async (_u, _sn, info) => {
    versuche++;
    if (info) info.status = response;
    return null;
  },
  createPreview: async () => {
    thumbAttempts.n++;
    return null;
  },
});
const { noDb } = require('./helpers/db');
const { emptyQueue } = require('./helpers/image-queue');
const db = testData();

test('a hopeless preview is only attempted ONCE', { concurrency: 1 }, async t => {
  // Marco's log
  try {
    await db.initSchemaOnce();
  } catch (e) {
    noDb(t, e);
    return;
  }
  // The queue must be emptied BEFORE use, not only the own
  // prefix — otherwise the batch takes the rows of a predecessor. Rationale
  // and reproduction in helpers/image-queue.js.
  await emptyQueue(db);
  const { SET_IMAGES_DIR } = _req('src/infra/appPaths.js');
  const fsm = require('node:fs');
  fsm.mkdirSync(SET_IMAGES_DIR, { recursive: true });
  const P = `WB${process.pid}`;
  const datei = path.join(SET_IMAGES_DIR, `${P}_1.jpg`);
  fsm.writeFileSync(datei, 'x'); // image present, preview impossible
  const IM = _req('src/images/imageMisses.js');
  const IQ = _req('src/images/imageDemandRun.js');
  await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['thumb:%' + P + '%']);

  try {
    thumbAttempts.n = 0;
    for (let runde = 1; runde <= 3; runde++) {
      await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
      await db.run(`INSERT INTO image_wanted (url, set_number) VALUES ($1,$2)`, [`https://cdn/${P}_1.jpg`, `${P}_1`]);
      await IQ._workStack();
    }
    assert.equal(
      thumbAttempts.n,
      1,
      `${thumbAttempts.n} attempts in three passes — a preview that cannot ` +
        'succeed may cost computing time only once',
    );
    await IM._writeBuffer();
    const gemerkt = (
      await db.get(`SELECT COUNT(*)::int c FROM image_misses WHERE cache_key LIKE $1`, ['thumb:%' + P + '%'])
    ).c;
    assert.equal(gemerkt, 1, 'The failure was not remembered permanently');
  } finally {
    fsm.rmSync(datei, { force: true });
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
    await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['thumb:%' + P + '%']).catch(() => {});
  }
});

test('throttling and a missing image are distinguished', { concurrency: 1 }, async t => {
  try {
    await db.initSchemaOnce();
  } catch (e) {
    noDb(t, e);
    return;
  }
  // The queue must be emptied BEFORE use, not only the own
  // prefix — otherwise the batch takes the rows of a predecessor. Rationale
  // and reproduction in helpers/image-queue.js.
  await emptyQueue(db);

  const P = `DR${process.pid}`;
  const fill = async () => {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
    await db.run(
      `INSERT INTO image_wanted (url, set_number)
                  SELECT 'https://cdn/'||$1||'_'||g||'.jpg', $1||'_'||g
                    FROM generate_series(1,10) g`,
      [P],
    );
  };
  const open = async () =>
    (await db.get(`SELECT COUNT(*)::int c FROM image_wanted WHERE set_number LIKE $1`, [P + '%'])).c;
  const gemerkt = async () =>
    (await db.get(`SELECT COUNT(*)::int c FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%'])).c;

  await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']);

  try {
    await t.test('403 locks out no image and loses no note', async () => {
      response = 403;
      versuche = 0;
      await fill();
      const IQ = _req('src/images/imageDemandRun.js');
      const e = await IQ._workStack();
      assert.equal(versuche, 1, `${versuche} attempts — after the first throttling the batch must abort`);

      // Put back is NOT processed
      assert.equal(
        e.total,
        0,
        `${e.total} reported as processed although the batch aborted before the first ` +
          'row and everything was put back',
      );
      assert.equal(
        e.setAside,
        10,
        'The notes put back appear in no counter — then ' + 'the message does not show that throttling happened',
      );
      assert.match(IQ.message(e), /zurückgelegt/, 'The message hides the throttling');
      assert.equal(
        await open(),
        10,
        'Notes got lost. The batch is fetched with DELETE … RETURNING ' + '— on abort the WHOLE rest must be put back.',
      );
      assert.equal(
        await gemerkt(),
        0,
        'A throttling was remembered as „Bild fehlt“ — then the rush locks out ' + 'exactly the images that exist',
      );
    });

    await t.test('the pause holds back the next run', async () => {
      const vorher = versuche;
      const n = (await _req('src/images/imageDemandRun.js')._workStack()).total;
      assert.equal(n, 0);
      assert.equal(
        versuche,
        vorher,
        'It kept asking — stubbornly asking again is exactly the behavior ' + 'that prolongs a block',
      );
    });

    await t.test('404 on the other hand is remembered', async () => {
      // The pause from the previous substep stands in the database and would otherwise keep applying.
      await db.run(`DELETE FROM job_pauses WHERE type = 'image_demand'`);
      const IQ = _req('src/images/imageDemandRun.js');
      response = 404;
      versuche = 0;
      await fill();
      await IQ._workStack();
      await _req('src/images/imageMisses.js')._writeBuffer();
      assert.equal(versuche, 10, `${versuche} attempts — on 404 the batch runs through`);
      assert.equal(await gemerkt(), 10, 'Missing images are not remembered — then the job asks for them again forever');
    });
  } finally {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
    await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']).catch(() => {});
    // Last DB test of this file — cleanup only happens here (lesson from 116).
    await db.pool.end().catch(() => {});
  }
});
