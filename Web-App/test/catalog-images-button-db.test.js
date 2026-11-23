/**
 * Button “fetch catalog images" and the preview for it.
 *
 * Counter-check: in src/management/service.ts skipped counts all candidates → red “the button queues, without known negative results”.
 * Counter-checks (22.11.2026): queueCatalogImages removed from registerActions() in admin.js → red “the button is wired
 * in the tile” (no message); the imgDl button removed from actions() in monitor.js → red the same test.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// Intercept download and downscaling — what counts here is WHAT is called.
let loaded = 0;
const shrunk = [];

const { buildAndRequire, testData, testImageWorker } = require('./helpers/sources');
const _req = buildAndRequire();
testImageWorker(null, {
  loadSetImage: async (_u, sn) => {
    loaded++;
    return `/images/sets/${sn}.jpg`;
  },
  createPreview: async p => {
    shrunk.push(p);
    return true;
  },
});
const { noDb } = require('./helpers/db');
const { emptyQueue } = require('./helpers/image-queue');
const { testServer } = require('./helpers/server');
const { adminWithFactor } = require('./helpers/admin');
const db = testData();

test('catalog images at the push of a button', { concurrency: 1 }, async t => {
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
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });
  const P = `KN${process.pid}`;
  const USER = `kn-${process.pid}`;
  const files = [`${P}_1.jpg`, `${P}_2.jpg`, `${P}_2_thumb.jpg`];

  await db.run(`DELETE FROM users WHERE username=$1`, [USER]);
  await db.run(`INSERT INTO users (username,password_hash,is_admin) VALUES ($1,'x',true)`, [USER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [USER])).id;
  await db.run(`DELETE FROM rb_sets WHERE set_num LIKE $1`, [P + '%']);
  await db.run(`DELETE FROM image_wanted`);
  await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']);
  await db.run(
    `INSERT INTO rb_sets (set_num,name,year,theme_id,num_parts,set_img_url)
                SELECT $1||'_'||g,'S',2020,1,10,'https://cdn.rebrickable.com/media/sets/'||$1||'_'||g||'.jpg'
                  FROM generate_series(1,10) g`,
    [P],
  );
  // _1: image present, preview missing. _2: both present.
  // _3: CONFIRMED 404 — stays out.
  // _4: miss marker WITHOUT reason (legacy from before an earlier round, when
  //     every network hiccup counted as “does not exist") — is taken back.
  fs.writeFileSync(path.join(SET_IMAGES_DIR, `${P}_1.jpg`), 'x');
  fs.writeFileSync(path.join(SET_IMAGES_DIR, `${P}_2.jpg`), 'x');
  fs.writeFileSync(path.join(SET_IMAGES_DIR, `${P}_2_thumb.jpg`), 'x');
  await db.run(`INSERT INTO image_misses (cache_key, reason) VALUES ($1,$2)`, [`set:${P}_3`, 'HTTP 404 vom CDN']);
  await db.run(`INSERT INTO image_misses (cache_key) VALUES ($1)`, [`set:${P}_4`]);

  await adminWithFactor(_req, uid);
  const { base, srv } = testServer(_req, { session: { userId: uid, isAdmin: 1 }, t });

  try {
    await t.test('the button queues, without known negative results', async () => {
      const d = await (await fetch(`${base}/api/v2/admin/catalog-images`, { method: 'POST' })).json();
      assert.equal(d.success, true);
      // finished items stay out
      assert.equal(
        d.queued,
        8,
        `${d.queued} queued instead of 8 — left out are sets with a CONFIRMED ` +
          'miss AND those that already have the image and preview locally',
      );
      assert.equal(
        d.skipped,
        1,
        `skipped=${d.skipped} instead of 1 — the feedback should say how many ` + 'were already done',
      );

      // “Can you adapt the logic so that it deletes the image_misses and
      // tries them again? Currently there are very many entries in the
      // table." — The many entries are the bug from an earlier round:
      // every network hiccup counted as “does not exist".
      assert.equal(
        d.discarded,
        1,
        `discarded=${d.discarded} instead of 1 — exactly the miss without a reason ` + 'should be taken back',
      );
      assert.equal(
        (await db.get(`SELECT COUNT(*)::int c FROM image_misses WHERE cache_key = $1`, [`set:${P}_3`])).c,
        1,
        'The confirmed 404 was deleted too. For old sets the CDN usually has ' +
          'no image — fetching all of them again would be half a day of pure ' +
          '404 traffic, and again on the next click.',
      );
      assert.equal(
        (await db.get(`SELECT COUNT(*)::int c FROM image_misses WHERE cache_key = $1`, [`set:${P}_4`])).c,
        0,
        'The miss without a reason is still there — then the image stays away for another ' +
          'seven days although nothing was ever wrong with it',
      );
      assert.ok(d.duration_minutes >= 0, 'The duration estimate is missing');
    });

    await t.test('a second click does not requeue anything finished', async () => {
      // The actual finding: after a full pass every click brought
      // the whole catalog back into the queue. The job processed that
      // correctly (file present → skip), but the tile showed
      // tens of thousands of open images, and every note cost a pass.
      await db.run(`DELETE FROM image_wanted`);
      const extra = [];
      for (let i = 1; i <= 10; i++) {
        for (const suffix of ['.jpg', '_thumb.jpg']) {
          const f = path.join(SET_IMAGES_DIR, `${P}_${i}${suffix}`);
          try {
            fs.writeFileSync(f, 'x', { flag: 'wx' });
            extra.push(f);
          } catch (e) {
            if (e.code !== 'EEXIST') throw e;
          }
        }
      }
      try {
        const d = await (await fetch(`${base}/api/v2/admin/catalog-images`, { method: 'POST' })).json();
        assert.equal(d.queued, 0, `${d.queued} queued although everything is done — exactly Marco’s finding`);
        assert.equal(d.pending, 0, 'The queue may stay empty');
      } finally {
        for (const f of extra) fs.rmSync(f, { force: true });
        // Bring the queue back into its initial state — the
        // substep below processes it and needs it filled.
        await (await fetch(`${base}/api/v2/admin/catalog-images`, { method: 'POST' })).json();
      }
    });

    await t.test('the job only fetches what is missing', async () => {
      const IQ = _req('src/images/imageDemandRun.js');
      let n = 0;
      // `.gesamt` = processed notes (loaded, preview created or
      // skipped). Since an earlier round the pass delivers a
      // breakdown instead of a bare number — otherwise the job was silent
      // exactly when it only skips.
      for (let i = 0; i < 3; i++) n += (await IQ._workStack()).total;
      assert.equal(loaded, 7, `${loaded} downloads instead of 7 — existing images must not ` + 'be fetched again');
      assert.ok(n >= 8, `only ${n} jobs processed`);
    });

    await t.test('missing previews are caught up, existing ones are not', async () => {
      // Marco's second question. For images stored before the background job,
      // the preview may be missing.
      assert.ok(shrunk.includes(`/images/sets/${P}_1.jpg`), 'The existing image without a preview does not get one');
      assert.ok(!shrunk.includes(`/images/sets/${P}_2.jpg`), 'An image with an existing preview is computed again');
      // And every freshly fetched image gets one.
      assert.equal(shrunk.length, loaded + 1, `${shrunk.length} previews for ${loaded} downloads + 1 caught up`);
    });

    // ── LAST, because this substep changes the stage ───────────────
    //
    // It takes back the miss marker of _3 and thereby enqueues the set. Further
    // up it stood first — and made the job checks below see one download
    // more than they expected. The substeps here share one
    // stage; whoever changes it belongs at the end.
    await t.test('alle_erneut also takes back the confirmed 404s', async () => {
      // For the case that the CDN has supplied images later. Deliberately NOT the
      // default: for old sets Rebrickable mostly has no image at all, and
      // refetching all of them costs hours at thirty requests per minute.
      const d = await (
        await fetch(`${base}/api/v2/admin/catalog-images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ all_again: true }),
        })
      ).json();
      assert.equal(d.success, true);
      assert.equal(
        (await db.get(`SELECT COUNT(*)::int c FROM image_misses WHERE cache_key = $1`, [`set:${P}_3`])).c,
        0,
        'With alle_erneut the confirmed 404 must be taken back too',
      );
    });
  } finally {
    for (const f of files) fs.rmSync(path.join(SET_IMAGES_DIR, f), { force: true });
    await db.run(`DELETE FROM rb_sets WHERE set_num LIKE $1`, [P + '%']).catch(() => {});
    await db.run(`DELETE FROM image_wanted`).catch(() => {});
    await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']).catch(() => {});
    await db.run(`DELETE FROM users WHERE username=$1`, [USER]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});

test('the button is wired in the tile', async () => {
  // In the real bundle: the image tile carries the button, a click queues and names both numbers.
  const { openUi, switchTab } = require('./helpers/ui');
  const { de } = require('./helpers/sources').loadTranslations();
  const { w, d, waitFor, settle, calls } = await openUi({
    '/v2/admin/job-status': { success: true, job: { running: false } },
    '/v2/admin/jobs': {
      success: true,
      jobs: { imgDl: { status: 'idle', label: 'Bilder', done: 0, total: 0 } },
      schedules: {},
      db: { csvCache: {}, blMapping: {} },
    },
    '/v2/admin/job-queue': {
      success: true,
      jobs: [],
      summary: [],
      job_process: { running: true },
      image_demand: 0,
      pauses: [],
    },
    '/v2/admin/catalog-images': { success: true, pending: 12, skipped: 3, discarded: 2, duration_minutes: 4 },
  });
  try {
    await switchTab(w, 'monitor');
    await settle();
    assert.ok(await waitFor(() => d.querySelector('[data-click="queueCatalogImages"]')), 'the button is missing');
    d.querySelector('[data-click="queueCatalogImages"]').click();
    const toasts = () => d.getElementById('toasts')?.textContent || '';
    const expected = de['monitor.catalog_images_queued_skipped'].replace('{n}', '12').replace('{done}', '3');
    assert.ok(await waitFor(() => toasts().includes(expected)), `message: ${toasts()}`);
    assert.ok(toasts().includes(de['monitor.catalog_images_retried'].replace('{n}', '2')), toasts());
    assert.ok(toasts().includes(de['monitor.catalog_images_eta'].replace('{n}', '4')), toasts());
    assert.ok(calls.some(a => a.method === 'POST' && a.url.endsWith('/api/v2/admin/catalog-images')));
  } finally {
    w.close();
  }
});
