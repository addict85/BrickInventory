/**
 * @einzeln: in the parallel run the test runner itself twice broke off while
 * reading this file's output (“Unable to deserialize cloned data”);
 * alone never. Cause in Node unclear, hence sequentially.
 *
 * The pacing of the image background job — and who can see it from outside.
 *
 * ── Marco's log ──────────────────────────────────────────────
 *     [image-queue] 10 bearbeitet: 0 geladen, 0 Vorschau erzeugt, 10 bereits vorhanden
 * five times in a row, with 1113 notes in the queue, and in the
 * tile next to it “Job noch nicht gelaufen".
 *
 * Two bugs in one picture:
 *
 *   1. The quota of thirty requests per minute (Marco's specification against
 *      a block by the CDN) was applied to NOTES instead of CDN
 *      requests. A note for which image and preview were long present thus cost
 *      the same as a download — 1113 finished images thus needed 37
 *      minutes of pure waiting.
 *
 *   2. The state of the last pass lay in the memory of the process
 *      that executes the job. The tile, however, is answered by any of the four
 *      worker processes — in three of four cases thus by one
 *      that knows nothing of it.
 *
 * Both are questions of behavior, not of source text. Hence this
 * test measures what the job DOES and reads the tile state from a SECOND PROCESS.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 *
 * Counter-check: in src/images/imageDemandRun.ts the skipped counter no longer counts → red “a tick clears finished notes instead of ten every twenty seconds”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// Intercept download and downscaling — what counts here is HOW OFTEN and WHEN they
// are called, not what they do.
const loadTimes = [];
/**
 * Switch for the intercepted download.
 */
let loadFailsFail = false;

const { buildAndRequire, testData, testImageWorker } = require('./helpers/sources');
const _req = buildAndRequire();
testImageWorker(null, {
  loadSetImage: async (_u, sn) => {
    // The failure also counts as a request: the round trip to the CDN has
    // taken place, and exactly that is what the quota is about.
    loadTimes.push(Date.now());
    return loadFailsFail ? null : `/images/sets/${sn}.jpg`;
  },
  createPreview: async () => true,
});
const { noDb } = require('./helpers/db');
const { emptyQueue } = require('./helpers/image-queue');
const { portOf } = require('./helpers/server');
const db = testData();
const IQ = _req('src/images/imageDemandRun.js');
const { SET_IMAGES_DIR } = _req('src/infra/appPaths.js');

/** Batch size and cap from the module — the test repeats no number. */
const { BATCH, PASS_MAX_NOTES: DECKEL } = IQ;

const created = [];
/** Put image AND preview in place — the job has nothing to do for this note. */
function finishedImage(sn) {
  for (const f of [`${sn}.jpg`, `${sn}_thumb.jpg`]) {
    const p = path.join(SET_IMAGES_DIR, f);
    fs.writeFileSync(p, 'x');
    created.push(p);
  }
}
const open = async p =>
  (await db.get(`SELECT COUNT(*)::int c FROM image_wanted WHERE set_number LIKE $1`, [p + '%'])).c;
/**
 * Enqueue notes — with ASCENDING `requested_at`.
 *
 * The batch fetches `ORDER BY requested_at ASC`. If a single INSERT for
 * all rows enters the same NOW(), the order is arbitrary — and a test
 * that targets batch boundaries then measures chance.
 */
const enqueue = async (prefix, from, until) => {
  await db.run(
    `INSERT INTO image_wanted (url, set_number, requested_at)
                  SELECT 'https://cdn/'||$1||'_'||g||'.jpg', $1||'_'||g,
                         NOW() - (($3::int - g) || ' seconds')::interval
                    FROM generate_series($2::int, $3::int) g`,
    [prefix, from, until],
  );
};

test('a tick clears finished notes instead of ten every twenty seconds', { concurrency: 1 }, async t => {
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
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });

  const P = `FE${process.pid}`;
  const COUNT = BATCH * 4;
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
  for (let i = 1; i <= COUNT; i++) finishedImage(`${P}_${i}`);
  await enqueue(P, 1, COUNT);

  try {
    loadTimes.length = 0;
    const t0 = Date.now();
    const e = await IQ._tickPass();
    const duration = Date.now() - t0;

    assert.equal(
      await open(P),
      0,
      `After one tick ${await open(P)} of ${COUNT} notes are still there. ` +
        'That was exactly Marco’s situation: the job was working, but with ' +
        `${BATCH} per twenty seconds — a good 37 minutes for 1113 finished images.`,
    );
    assert.equal(e.skipped, COUNT, 'Not all were counted as „vorhanden“');
    assert.equal(e.work, 0, 'An image with its preview must not cause any work step');
    assert.equal(loadTimes.length, 0, 'The CDN was asked although everything was there');
    // Without real work no politeness pause may occur either: it protects
    // the CDN, and that was not touched here.
    assert.ok(
      duration < 2000,
      `The tick needed ${duration} ms for pure skips — then the ` + 'pause still applies in the wrong place',
    );
  } finally {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
  }
});

test('the quota applies to real work, not to notes', { concurrency: 1 }, async t => {
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

  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });
  const P = `KO${process.pid}`;
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
  // ── Deliberately across BATCH BOUNDARIES ─────────────────────────────────
  //
  // Every third entry must be loaded, the rest lies there finished. The
  // ten requests thereby spread over several batches — only then does the
  // spacing test below measure a batch boundary at all. If all ten lay in the first
  // batch, the old, too narrow cut of the pause would go undetected.
  const COUNT = BATCH * 4;
  const toLoad = new Set();
  for (let i = 1; i <= COUNT; i++) {
    if (i % 3 === 0) toLoad.add(i);
    else finishedImage(`${P}_${i}`);
  }
  assert.ok(toLoad.size > BATCH, 'Precondition: more to load than the quota');
  await enqueue(P, 1, COUNT);

  try {
    loadTimes.length = 0;
    const e = await IQ._tickPass();

    await t.test('at most STAPEL requests per tick', async () => {
      assert.equal(
        loadTimes.length,
        BATCH,
        `${loadTimes.length} CDN requests in one tick — ${BATCH} are allowed. ` +
          'The rate at the CDN is Marco’s requirement and must NOT increase by catching up ' +
          'on batches.',
      );
      assert.equal(e.work, BATCH);
      assert.ok((await open(P)) > 0, 'The rest must stay');
      // Precondition for the spacing test: the ten requests really lay in
      // more than one batch.
      assert.ok(
        e.total > BATCH,
        `all ${e.work} requests were in a single batch — then ` +
          'the gap test below does not check the batch boundary at all',
      );
    });

    await t.test('half a second lies between two requests', () => {
      const abst = loadTimes.slice(1).map((z, i) => z - loadTimes[i]);
      const smallest = Math.min(...abst);
      assert.ok(
        smallest >= 500,
        `smallest gap ${smallest} ms. The pause used to depend on a counter ` +
          'WITHIN a batch — as soon as a tick catches up on several batches, ' +
          'two requests would otherwise run right after each other.',
      );
    });
  } finally {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
  }
});

test("skips use no quota — Marco's mixed queue", { concurrency: 1 }, async t => {
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
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });

  // The normal case after the button “fetch catalog images": a few missing
  // images, scattered among hundreds that were long present.
  const P = `MX${process.pid}`;
  const DONE = BATCH * 5,
    TO_LOAD = 3;
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
  for (let i = 1; i <= DONE; i++) finishedImage(`${P}_${i}`);
  await enqueue(P, 1, DONE + TO_LOAD);

  try {
    loadTimes.length = 0;
    const e = await IQ._tickPass();
    assert.equal(
      await open(P),
      0,
      'One tick must clear the whole stretch — the three missing images ' +
        'are below the quota, the finished ones cost nothing',
    );
    assert.equal(e.fetched, TO_LOAD);
    assert.equal(e.skipped, DONE);
    assert.equal(loadTimes.length, TO_LOAD, 'More was loaded than necessary');
  } finally {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
  }
});

test('a tick looks through at most DURCHGANG_MAX_NOTIZEN notes', { concurrency: 1 }, async t => {
  // The cap is necessary because `existsSync` is synchronous: without it a
  // queue of 25 000 finished images would run through in one go and hold up
  // the worker process's event loop in bursts.
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
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });

  const P = `DK${process.pid}`;
  const COUNT = DECKEL + BATCH * 2;
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
  for (let i = 1; i <= COUNT; i++) finishedImage(`${P}_${i}`);
  await enqueue(P, 1, COUNT);

  try {
    const e = await IQ._tickPass();
    assert.equal(e.total, DECKEL, `${e.total} notes in one tick — the cap is ${DECKEL}`);
    assert.equal(await open(P), COUNT - DECKEL, 'The rest must wait for the next tick');
  } finally {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
  }
});

test('expired notes are really deleted', { concurrency: 1 }, async t => {
  // What the comment claimed and the code did not do
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

  const P = `VF${process.pid}`;
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
  await db.run(
    `INSERT INTO image_wanted (url, set_number, requested_at)
                VALUES ($1, $2, NOW() - INTERVAL '30 days')`,
    [`https://cdn/${P}_alt.jpg`, `${P}_alt`],
  );
  await db.run(
    `INSERT INTO image_wanted (url, set_number, requested_at)
                VALUES ($1, $2, NOW())`,
    [`https://cdn/${P}_neu.jpg`, `${P}_neu`],
  );

  try {
    // Precondition: the batch does not even touch the old note — exactly
    // that is why it stayed.
    const e = await IQ._tickPass();
    assert.equal(e.total, 1, 'The old note must not be processed');
    assert.equal(await open(P), 1, 'Only the old note should still be there');

    const route = await IQ._deleteExpired();
    assert.ok(route >= 1, 'No expired note was deleted');
    assert.equal(
      await open(P),
      0,
      'The expired note is still there — it then counts in the ' + 'tile forever without ever being processed',
    );
  } finally {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
  }
});

test('ANOTHER process sees that the job has run', { concurrency: 1 }, async t => {
  // ── Why as a separate process (lesson from an earlier round) ─────────────────────
  // A test that checks in the same process cannot see this bug: the
  // marker lies exactly there. The tile, however, is answered by ANY of the
  // four worker processes, and none of them executes the job.
  // Hence the job runs in the child process here and the parent asks.
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

  await db.run(`DELETE FROM run_state WHERE key='imgqueue_last_run'`);
  const prior = await db.get(`SELECT value FROM run_state WHERE key='imgqueue_last_run'`);
  assert.equal(prior, undefined, 'Precondition: no run state stored yet');

  // The child process knows NOTHING from this one — it does not build but uses
  // the already generated dist/ and only runs one tick.
  // The child does NOT set the address itself, it inherits it via the environment.
  execFileSync(
    process.execPath,
    [
      '-e',
      `
    const V = require(${JSON.stringify(path.join(ROOT, 'dist', 'startup', 'wiring.js'))});
    const { dbConfigFromEnvironment, createDb } = require(${JSON.stringify(path.join(ROOT, 'dist', 'db', 'database.js'))});
    const db = createDb(dbConfigFromEnvironment(), { firstStart: async () => {} });
    const contexts = {};
    V.buildServices(db, { contexts });
    const IQ = require(${JSON.stringify(path.join(ROOT, 'dist', 'src/images/imageDemandRun.js'))});
    (async () => {
      await db.initSchemaOnce();
      await IQ._tickPass(contexts.images);
      await db.pool.end();
    })().catch(e => { console.error(e); process.exit(1); });
  `,
    ],
    { env: process.env, stdio: 'pipe' },
  );

  const row = await db.get(`SELECT value FROM run_state WHERE key='imgqueue_last_run'`);
  assert.ok(
    row?.value,
    'The pass of another process is not visible here. Then ' +
      'the tile reports „Job noch nicht gelaufen“ while the log shows passes — ' +
      'exactly Marco’s finding.',
  );
  const state = JSON.parse(row.value);
  assert.ok(Date.now() - state.zeit < 60_000, 'The stored time is not plausible');

  // And now up to the TILE
  const IQhere = _req('src/images/imageDemandRun.js');
  IQhere.lastRun.zeit = null;
  IQhere.lastRun.ergebnis = null;

  const USER = `pace-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username=$1`, [USER]);
  await db.run(`INSERT INTO users (username,password_hash,is_admin) VALUES ($1,'x',true)`, [USER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [USER])).id;
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    /** @type {any} */ (req).session = { userId: uid, isAdmin: 1 };
    /** @type {any} */ (req).apiUser = { user_id: uid, is_admin: 1 };
    next();
  });
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2', require('./helpers/sources').routerFrom(_req, 'routes/api/index.js'));
  const srv = app.listen(0);
  try {
    const tile = (await (await fetch(`http://localhost:${portOf(srv)}/api/v2/admin/jobs`)).json()).jobs?.imgDl;
    assert.ok(
      tile?.queueLastRun,
      'The tile does not know the pass of the other process. That is exactly how ' +
        'Marco’s „Job noch nicht gelaufen“ came about: the marker was in the ' +
        'memory of the process that runs the job — but the request ' +
        'is answered by any of the four.',
    );
  } finally {
    await new Promise(r => srv.close(r));
    await db.run(`DELETE FROM users WHERE username=$1`, [USER]).catch(() => {});
  }

  await db.run(`DELETE FROM run_state WHERE key='imgqueue_last_run'`).catch(() => {});
});

test('every exit of the loop has a counter', { concurrency: 1 }, async t => {
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
  const MISSES = _req('src/images/imageMisses.js');
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });

  await t.test('note without a set number', async () => {
    const P = `ON${process.pid}`;
    await db.run(`DELETE FROM image_wanted WHERE url LIKE $1`, [`%${P}%`]);
    await db.run(`INSERT INTO image_wanted (url, set_number) VALUES ($1, NULL)`, [`https://cdn/${P}.jpg`]);
    const e = await IQ._workStack();
    assert.equal(
      e.withoutNumber,
      1,
      'A note without a set number disappears without a trace — it counted as ' +
        '„bearbeitet“ without appearing anywhere',
    );
    assert.equal(e.fetched + e.preview + e.skipped, 0);
    await db.run(`DELETE FROM image_wanted WHERE url LIKE $1`, [`%${P}%`]).catch(() => {});
  });

  await t.test('failed download', async () => {
    // The intercepted download delivers null for this substep — exactly its
    // behavior on HTTP 404, network error or too small a response.
    const P = `FD${process.pid}`;
    loadFailsFail = true;
    try {
      await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
      await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']);
      await enqueue(P, 1, 2);
      const e = await IQ._workStack();
      assert.equal(e.notLoaded, 2, 'Marco’s case: two notes, no image, and no counter named the reason');
      assert.equal(e.total, 2);
      assert.match(
        IQ.message(e),
        /2 Download fehlgeschlagen/,
        'The message does not name the failure — then it shows zero three times ' + 'and the question remains open',
      );
    } finally {
      loadFailsFail = false;
      await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
      await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']).catch(() => {});
    }
  });

  await t.test('an image known to be missing costs neither quota nor waiting time', async () => {
    // rememberMissing('set:…') was written but never read in the job: a
    // note that arises anew via the proxy triggered on every pass
    // again a round trip to an image the CDN demonstrably does not
    // have — and used up a slot in the quota for it.
    const P = `BF${process.pid}`;
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
    await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']);
    const COUNT = BATCH;
    for (let i = 1; i <= COUNT; i++) MISSES.rememberMissing(`set:${P}_${i}`);
    await MISSES._writeBuffer();
    await enqueue(P, 1, COUNT);
    try {
      loadTimes.length = 0;
      const t0 = Date.now();
      const e = await IQ._tickPass();
      const duration = Date.now() - t0;
      assert.equal(e.knownMissing, COUNT, 'The marker is not read in the job');
      assert.equal(loadTimes.length, 0, `${loadTimes.length} CDN requests for images that are known ` + 'not to exist');
      assert.equal(
        e.work,
        0,
        'A known missing image uses up a slot in the quota — ' +
          'then of all things the hopeless notes slow down the promising ones',
      );
      assert.ok(
        duration < 2000,
        `${duration} ms for ${COUNT} known missing images — the politeness pause ` +
          'protects the CDN, and it was not touched at all here',
      );
    } finally {
      await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
      await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']).catch(() => {});
    }
  });
});

test('clean up', { concurrency: 1 }, async () => {
  for (const f of created) fs.rmSync(f, { force: true });
  // Last test of this file — only here is the pool closed. (Lesson from
  // an earlier round: a pool closed earlier makes every following DB test
  // red, and the message does not name the reason.)
  await db.pool.end().catch(() => {});
});
