/**
 * What “missing" means — and how to take it back.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

/** Response of the intercepted download: null plus a status code as desired. */
let responseStatus = null;

const { buildAndRequire, testData, testImageWorker } = require('./helpers/sources');
const _req = buildAndRequire();
testImageWorker(null, {
  loadSetImage: async (_u, _sn, info) => {
    if (responseStatus && info) info.status = responseStatus;
    return null; // failure — the status code decides the rest
  },
});
const { noDb } = require('./helpers/db');
const { emptyQueue } = require('./helpers/image-queue');
const { testServer } = require('./helpers/server');
const { adminWithFactor } = require('./helpers/admin');
const db = testData();
const IQ = _req('src/images/imageDemandRun.js');
const MISSES = _req('src/images/imageMisses.js');

const enqueue = async sn => {
  await db.run(`DELETE FROM image_wanted WHERE set_number = $1`, [sn]);
  await db.run(`INSERT INTO image_wanted (url, set_number) VALUES ($1, $2)`, [`https://cdn/${sn}.jpg`, sn]);
};
const marker = async sn => db.get(`SELECT checked_at, reason FROM image_misses WHERE cache_key = $1`, ['set:' + sn]);

test('only a 404 means "the image does not exist"', { concurrency: 1 }, async t => {
  try {
    await db.initSchemaOnce();
    await db.runMigrations?.();
  } catch (e) {
    noDb(t, e);
    return;
  }
  // The queue must be emptied BEFORE use, not only the own
  // prefix — otherwise the batch takes the rows of a predecessor. Rationale
  // and reproduction in helpers/image-queue.js.
  await emptyQueue(db);
  const P = `MR${process.pid}`;

  await t.test('404 is remembered, with a reason', async () => {
    const sn = `${P}_404`;
    await db.run(`DELETE FROM image_misses WHERE cache_key = $1`, ['set:' + sn]);
    MISSES._emptyForeground();
    responseStatus = 404;
    await enqueue(sn);
    const e = await IQ._workStack();
    await MISSES._writeBuffer();
    assert.equal(e.notLoaded, 1);
    const m = await marker(sn);
    assert.ok(
      m,
      'A 404 must be remembered — otherwise every old set is searched ' + 'at the CDN again on every page turn',
    );
    assert.match(m.reason || '', /404/, 'The reason is missing — then image-diag again only says „gilt als fehlend“');
    await db.run(`DELETE FROM image_misses WHERE cache_key = $1`, ['set:' + sn]);
  });

  await t.test('a batch of nothing but 404s reports as warn, not as error', async () => {
    // Marco's log
    const sn = `${P}_leise`;
    await db.run(`DELETE FROM image_misses WHERE cache_key = $1`, ['set:' + sn]);
    MISSES._emptyForeground();
    responseStatus = 404;
    await enqueue(sn);

    const origErr = console.error,
      origWarn = console.warn;
    const asError = [],
      asWarn = [];
    console.error = (...a) => asError.push(a.map(String).join(' '));
    console.warn = (...a) => asWarn.push(a.map(String).join(' '));
    try {
      await IQ._workStack();
    } finally {
      console.error = origErr;
      console.warn = origWarn;
    }
    await MISSES._writeBuffer();

    const queueErr = asError.filter(z => z.startsWith('[image-queue]'));
    const queueWarn = asWarn.filter(z => z.startsWith('[image-queue]'));
    assert.deepEqual(queueErr, [], `A pure 404 batch was reported as error: ${queueErr.join(' | ')}`);
    assert.equal(
      queueWarn.length,
      1,
      `Expected EXACTLY one warn line, got ${queueWarn.length}: ${queueWarn.join(' | ')}. ` +
        'None would mean the batch is now completely silent — and then nobody ' +
        'notices anymore WHICH sets have no image.',
    );
    assert.match(queueWarn[0], new RegExp(sn), 'The set number is missing in the message');
    await db.run(`DELETE FROM image_misses WHERE cache_key = $1`, ['set:' + sn]);
  });

  await t.test('COUNTER-CHECK: a retryable error stays error', async () => {
    // Without this case the rule above would also be fulfilled if the
    // summary line ALWAYS went to warn — and then nothing stands out anymore.
    // No status code means “temporary, will be retried": exactly
    // what someone should see.
    const sn = `${P}_laut`;
    await db.run(`DELETE FROM image_misses WHERE cache_key = $1`, ['set:' + sn]);
    MISSES._emptyForeground();
    responseStatus = null;
    await enqueue(sn);

    const origErr = console.error,
      origWarn = console.warn;
    const asError = [],
      asWarn = [];
    console.error = (...a) => asError.push(a.map(String).join(' '));
    console.warn = (...a) => asWarn.push(a.map(String).join(' '));
    try {
      await IQ._workStack();
    } finally {
      console.error = origErr;
      console.warn = origWarn;
    }

    const queueErr = asError.filter(z => z.startsWith('[image-queue]'));
    assert.equal(
      queueErr.length,
      1,
      `A retryable error must be reported as error, got ` +
        `${queueErr.length} error and ${asWarn.filter(z => z.startsWith('[image-queue]')).length} warn lines`,
    );
    assert.match(
      queueErr[0],
      /wird erneut versucht/,
      'The message does not say that it is retried — that is exactly what distinguishes ' +
        'it from the 404, which is final',
    );
    await db.run(`DELETE FROM image_misses WHERE cache_key = $1`, ['set:' + sn]);
  });

  await t.test('a timeout does NOT lock out for seven days', async () => {
    // No status code: exactly the picture of a network error. downloadSetImage
    // only sets info.status for a response ≠ 200 — if the connection
    // breaks off, the field stays empty.
    const sn = `${P}_timeout`;
    await db.run(`DELETE FROM image_misses WHERE cache_key = $1`, ['set:' + sn]);
    MISSES._emptyForeground();
    responseStatus = null;
    await enqueue(sn);
    const e = await IQ._workStack();
    await MISSES._writeBuffer();
    assert.equal(e.notLoaded, 1, 'The failure must still be counted');
    assert.equal(
      await marker(sn),
      undefined,
      'A transient error was recorded as „Bild existiert nicht“. ' +
        'That is exactly how images disappear for seven days without anything ' +
        'ever being wrong with them — and nobody sees that there was an attempt at all.',
    );
    assert.match(IQ.message(e), /Download fehlgeschlagen/);
  });

  await t.test('the same standard as in the image proxy', () => {
    // The proxy has always only remembered 404 and explains that in the code. That
    // both components write into THE SAME table but interpret it differently
    // was the actual bug. The rule is held together here.
    const fs = require('node:fs');
    const { withoutComments } = require('./helpers/sources');
    const proxy = withoutComments(require('./helpers/sources').proxyThumbSource());
    const job = withoutComments(fs.readFileSync(path.join(ROOT, 'src/images/imageDemandRun.ts'), 'utf8'));
    assert.match(
      proxy,
      /status === 404[\s\S]{0,200}rememberMissing/,
      'In the proxy the miss no longer depends on the 404',
    );
    assert.match(
      job,
      /info\.status === 404/,
      'The job does not distinguish the 404 — then every ' + 'network error locks the image out for seven days again',
    );
    assert.doesNotMatch(
      job,
      /\n\s*rememberMissing\(k, 'set:' \+ r\.set_number\);/,
      'There is an unconditional note for sets again',
    );
  });

  responseStatus = null;
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
  await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']).catch(() => {});
});

test('negative results can be withdrawn and are explainable', { concurrency: 1 }, async t => {
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

  const P = `VG${process.pid}`;
  const USER = `vg-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username=$1`, [USER]);
  await db.run(`INSERT INTO users (username,password_hash,is_admin) VALUES ($1,'x',true)`, [USER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [USER])).id;

  await adminWithFactor(_req, uid);
  const { base, srv } = testServer(_req, { session: { userId: uid, isAdmin: 1 }, t });

  try {
    await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']);
    MISSES._emptyForeground();
    MISSES.rememberMissing(`set:${P}_1`, 'HTTP 404 vom CDN');
    await MISSES._writeBuffer();

    await t.test('image-diag names the flag and the reason', async () => {
      const a = await (await fetch(`${base}/api/v2/admin/image-diag/${P}_1`)).json();
      assert.ok(a.marker, 'Of all things, the table that prevents the fetch ' + 'did not appear in the diagnosis');
      assert.match(a.marker.reason || '', /404/);
      assert.ok(
        a.hints.some(h => /als fehlend/.test(h)),
        'The plain-text hint is missing — then one first has to interpret the response',
      );
    });

    await t.test('withdrawing works', async () => {
      const r = await (
        await fetch(`${base}/api/v2/admin/forget-image-misses`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ set_numbers: [`${P}_1`] }),
        })
      ).json();
      assert.equal(r.removed, 1);
      assert.equal(await marker(`${P}_1`), undefined, 'The entry is still there');
      assert.equal(
        MISSES.isKnownMissing(`set:${P}_1`),
        false,
        'In memory the image still counts as missing — then ' + 'nothing changes until the next refresh',
      );
    });

    await t.test('preview notes stay untouched', async () => {
      MISSES.rememberMissing('thumb:/irgendwo/xyz_thumb.jpg', 'Vorschau konnte nicht erzeugt werden');
      await MISSES._writeBuffer();
      await (
        await fetch(`${base}/api/v2/admin/forget-image-misses`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).json();
      const t2 = await db.get(`SELECT 1 FROM image_misses WHERE cache_key = $1`, ['thumb:/irgendwo/xyz_thumb.jpg']);
      assert.ok(
        t2,
        'A run without a parameter took the preview notes along — ' +
          'they have a different purpose than „Bild gibt es nicht“',
      );
      await db.run(`DELETE FROM image_misses WHERE cache_key = $1`, ['thumb:/irgendwo/xyz_thumb.jpg']);
    });
  } finally {
    await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']).catch(() => {});
    await db.run(`DELETE FROM users WHERE username=$1`, [USER]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
