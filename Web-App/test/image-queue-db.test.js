/**
 * Images are stored locally in the BACKGROUND — the request computes nothing.
 *
 * Counter-check: in src/management/jobMonitor.ts queue fixed to 0 → red “the tile "image download (CDN)" shows the catalog queue”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// Intercept download and downscaling — what counts here is WHEN they are called,
// not what they do.
let loaded = 0,
  shrunk = 0;

const { buildAndRequire, testData, testImageWorker } = require('./helpers/sources');
const _req = buildAndRequire();
testImageWorker(null, {
  loadSetImage: async () => {
    loaded++;
    return '/images/sets/test.jpg';
  },
  createPreview: async () => {
    shrunk++;
    return true;
  },
});
const { dataOrSkip, noDb } = require('./helpers/db');
const { emptyQueue } = require('./helpers/image-queue');
const { testServer } = require('./helpers/server');
const { adminWithFactor } = require('./helpers/admin');
const db = testData();

test('the request takes a note, the job stores', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;
  // The queue must be emptied BEFORE use, not only the own
  // prefix — otherwise the batch takes the rows of a predecessor. Rationale
  // and reproduction in helpers/image-queue.js.
  await emptyQueue(db);

  const IQ = _req('src/images/imageDemandRun.js');
  await IQ.setUpImageDemand();
  const PREFIX = `TQ${process.pid}`;
  const route = async () => db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [PREFIX + '%']).catch(() => {});
  await route();

  try {
    await t.test('duplicate notes count once', async () => {
      // When scrolling the same image comes by several times. Without deduplication
      // it would stand several times in the queue and be fetched several times.
      for (let i = 1; i <= 25; i++)
        IQ.rememberUsed(`https://cdn.rebrickable.com/media/sets/${PREFIX}_${i}.jpg`, `${PREFIX}_${i}`);
      IQ.rememberUsed(`https://cdn.rebrickable.com/media/sets/${PREFIX}_1.jpg`, `${PREFIX}_1`);
      // Since an earlier round it is BUFFERED: rememberUsed() no longer writes anything
      // itself — one INSERT per image request drained the connection pool. The
      // writing runs on a timer; triggered by hand here.
      await IQ._writeBuffer();
      const n = (await db.get(`SELECT COUNT(*)::int c FROM image_wanted WHERE set_number LIKE $1`, [PREFIX + '%'])).c;
      assert.equal(n, 25, `${n} notes instead of 25`);
    });

    await t.test('the job works in batches, not everything at once', async () => {
      // The point of the matter: on weak hardware the whole backlog must not
      // be computed in one go.
      // The batch size stands in the source (: raised from 5 to 20
      // after the CPU causes were fixed). The test reads it …
      const stack = IQ.BATCH;
      assert.ok(stack > 0, '„STAPEL“ not found');
      const prior = loaded;
      const n1 = (await IQ._workStack()).total;
      assert.ok(n1 > 0 && n1 <= stack, `${n1} images in one pass at „STAPEL“ = ${stack} — the limit does not apply`);
      assert.ok(n1 < 25, 'The whole backlog was computed in one go');
      assert.equal(loaded - prior, n1, 'more images were fetched than processed');
      assert.equal(shrunk, loaded, 'every fetched image has a preview');
    });

    await t.test('at the end no note remains', async () => {
      for (let i = 0; i < 5; i++) await IQ._workStack();
      const n = (await db.get(`SELECT COUNT(*)::int c FROM image_wanted WHERE set_number LIKE $1`, [PREFIX + '%'])).c;
      assert.equal(n, 0, `${n} notes left`);
    });
  } finally {
    await route();
    // Do NOT close the pool here: the tile test further below still needs it.
    // It closes as the last DB test.
  }
});

test('the tile "image download (CDN)" shows the catalog queue', { concurrency: 1 }, async t => {
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

  const USER = `ka-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username=$1`, [USER]);
  await db.run(`INSERT INTO users (username,password_hash,is_admin) VALUES ($1,'x',true)`, [USER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [USER])).id;

  await adminWithFactor(_req, uid);
  const { base, srv } = testServer(_req, { session: { userId: uid, isAdmin: 1 }, t });
  const tile = async () => (await (await fetch(`${base}/api/v2/admin/jobs`)).json()).jobs?.imgDl;

  try {
    await db.run(`DELETE FROM image_wanted`);
    const empty = await tile();
    assert.ok(empty, 'The tile is missing in the response');
    assert.equal(empty.queue, 0);
    assert.doesNotMatch(empty.sub, /Katalog/, 'Without a queue the tile should not talk about catalog images');

    await db.run(`INSERT INTO image_wanted (url,set_number)
                  SELECT 'https://x/'||g||'.jpg', 'KA'||g FROM generate_series(1,137) g`);
    const full = await tile();
    assert.equal(full.queue, 137, 'The queue is not counted');
    assert.match(full.sub, /137 Katalog-Bilder in Warteschlange/, 'The number is not in the text of the tile');
    // “stock" must stand next to it — otherwise one does not know what the
    // OTHER number refers to.
    assert.match(full.sub, /Bestand:/, 'Without this label the two numbers cannot be told apart');
    // “running" now means: has done something recently
    await db.run(`DELETE FROM run_state WHERE key='imgqueue_last_run'`);
    await db.run(`DELETE FROM run_state WHERE key='imgredl_status'`);
    await _req('src/management/tiles.js')
      .imgDlReset()
      .catch(() => {});
    _req('src/images/imageDemandRun.js').lastRun.zeit = null;
    const withoutRun = await tile();
    assert.equal(withoutRun.status, 'idle', 'Without a pass the tile must not report activity');
    assert.match(withoutRun.sub, /Job noch nicht gelaufen/, 'The tile hides that the job has not run yet');

    // And after a pass it reports operation. What is meant is the TICK —
    // there the state is stored for the other worker processes.
    await _req('src/images/imageDemandRun.js')._tickPass();
    const afterRun = await tile();
    assert.equal(afterRun.status, 'running', 'After a pass the tile must report activity');
    assert.ok(afterRun.queueLastRun, 'The time of the last pass is missing');
    // And the bar must not stand at 100 % while something is still pending.
    assert.ok(full.total >= 137, `total=${full.total} does not contain the queue`);

    // A STUCK “running" is not operation
    await db.run(`DELETE FROM run_state WHERE key='imgqueue_last_run'`);
    _req('src/images/imageDemandRun.js').lastRun.zeit = null;
    await _req('src/management/tiles.js')
      .imgDlReset()
      .catch(() => {});
    assert.notEqual(
      (await tile()).status,
      'running',
      'Precondition violated: without a follow-up there must be no activity here',
    );

    const redeliver = async at =>
      db.run(
        `INSERT INTO run_state (key, value) VALUES ('imgredl_status',$1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [JSON.stringify({ running: true, phase: 'scanning', at })],
      );

    await redeliver(Date.now());
    const fresh = await tile();
    assert.equal(fresh.status, 'running', 'A FRESH follow-up must still count as activity');

    await redeliver(Date.now() - 10 * 60_000);
    const alt = await tile();
    assert.notEqual(
      alt.status,
      'running',
      'A ten-minute-old state still counts as activity — then the ' +
        'tile stays on „läuft“ forever after an aborted run.',
    );
    await db.run(`DELETE FROM run_state WHERE key='imgredl_status'`);
  } finally {
    await db.run(`DELETE FROM image_wanted`).catch(() => {});
    await db.run(`DELETE FROM users WHERE username=$1`, [USER]).catch(() => {});
    await new Promise(r => srv.close(r));
    // Last test with database in this file.
    await db.pool.end().catch(() => {});
  }
});

test('the job also reports pure skips', () => {
  // Marco's finding
  const { message } = _req('src/images/imageDemandRun.js');
  const onlySkipped = {
    fetched: 0,
    preview: 0,
    skipped: 10,
    total: 10,
    notLoaded: 0,
    noPreview: 0,
    knownMissing: 0,
    withoutNumber: 0,
    setAside: 0,
    work: 0,
  };
  const text = message(onlySkipped);
  assert.match(text, /10 bearbeitet/, 'A pass with nothing but skips does not name its number');
  assert.match(
    text,
    /10 bereits vorhanden/,
    'The message does not name the skips — then one does not know whether the ' + 'job is working or only idling',
  );

  // And the tick must not conceal them: the condition before the output
  // must not depend on any number that is zero for pure skips.
  const q = fs.readFileSync(path.join(ROOT, 'src/images/imageDemandRun.ts'), 'utf8');
  const i = q.indexOf('async function processImageDemand');
  assert.ok(i > 0, 'No tick');
  const fn = q.slice(i, q.indexOf('\n}\n', i)).replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(
    fn,
    /if \(e\.geholt/,
    'Only loaded images are reported — a pass with nothing but ' + 'skips stays invisible',
  );
  assert.match(
    fn,
    /message\(e\)/,
    'The tick assembles the text itself — then message and counters ' + 'drift apart as soon as a counter is added',
  );
});

test('the image tables come from a MIGRATION, not from initSchema', () => {
  // Marco's finding
  const mig = fs.readFileSync(path.join(ROOT, 'db/migrations/0009-bild-tabellen.sql'), 'utf8');
  assert.match(mig, /CREATE TABLE IF NOT EXISTS image_wanted/, 'image_wanted is missing in the migration');
  assert.match(mig, /CREATE TABLE IF NOT EXISTS image_misses/, 'image_misses is missing in the migration');

  // And NO longer elsewhere — two places that create the same thing drift
  // apart at some point.
  for (const file of ['db/database.ts', 'src/images/imageMisses.ts', 'src/images/imageDemandRun.ts']) {
    const src = fs
      .readFileSync(path.join(ROOT, file), 'utf8')
      .split('\n')
      .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('--'))
      .join('\n');
    assert.doesNotMatch(
      src,
      /CREATE TABLE IF NOT EXISTS image_(wanted|misses)/,
      `${file} also creates the table — that belongs only in the migration`,
    );
  }

  // The init functions run AFTER schema and migrations (otherwise the
  // table is missing when loading the stock) and in every worker process: they stand in
  // startup/database.ts behind initSchemaOnce(), which every process calls.
  const preparation = fs.readFileSync(path.join(ROOT, 'startup/database.ts'), 'utf8');
  const schema = preparation.indexOf('await db.initSchemaOnce()');
  assert.ok(
    schema > 0 && preparation.indexOf('await d.images.startNone()') > schema,
    'setUpImageGaps() runs before the migrations — then the table is still missing',
  );
});

test('the request no longer computes anything, it only takes notes', () => {
  // Checked on the source text because it is about the ORDER: in the
  // gen=0 case the proxy must not trigger a downscale but must leave
  // the note. A test via the route would not distinguish the two —
  // delivery is immediate either way.
  const px = require('./helpers/sources').compact(require('./helpers/sources').proxyThumbSource());
  assert.match(px, /const note = \(\) => \{/, 'The proxy leaves no note');
  assert.match(
    px,
    /if \(createMay\) queueThumb\((?:\s*(?:kx?|sk|t)(?:: \w+)?(?:,\s*|(?=\s*\))))?cacheFile, thumbFile\); else note\(\);/,
    'In the gen=0 case it still downscales immediately instead of noting',
  );
  // And the note needs the set number — without it the job does not know where to.
  assert.match(px, /const setNumber = setNumberFromImageAddress\(/, 'The set number is not read from the address');
  assert.equal(
    _req('routes/imgProxy.js').setNumberFromImageAddress('https://cdn.rebrickable.com/media/sets/10294-1.jpg'),
    '10294-1',
    'The set number is not read from the address',
  );
});
