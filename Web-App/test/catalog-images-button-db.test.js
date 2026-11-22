/**
 * Button “fetch catalog images" and the preview for it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// Intercept download and downscaling — what counts here is WHAT is called.
let geladen = 0;
const verkleinert = [];

const { buildAndRequire, testData, testImageWorker } = require('./helpers/sources');
const _req = buildAndRequire();
testImageWorker(null, {
  loadSetImage: async (_u, sn) => {
    geladen++;
    return `/images/sets/${sn}.jpg`;
  },
  createPreview: async p => {
    verkleinert.push(p);
    return true;
  },
});
const { keineDb } = require('./helpers/db');
const { emptyQueue } = require('./helpers/image-queue');
const { testServer } = require('./helpers/server');
const { adminWithFactor } = require('./helpers/admin');
const db = testData();

test('catalog images at the push of a button', { concurrency: 1 }, async t => {
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
  const P = `KN${process.pid}`;
  const NUTZER = `kn-${process.pid}`;
  const dateien = [`${P}_1.jpg`, `${P}_2.jpg`, `${P}_2_thumb.jpg`];

  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash,is_admin) VALUES ($1,'x',true)`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;
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
  const { base, srv } = testServer(_req, { sitzung: { userId: uid, isAdmin: 1 }, t });

  try {
    await t.test('the button queues, without known negative results', async () => {
      const d = await (await fetch(`${base}/api/v1/admin/catalog-images`, { method: 'POST' })).json();
      assert.equal(d.success, true);
      // finished items stay out
      assert.equal(
        d.queued,
        8,
        `${d.queued} eingereiht statt 8 — draussen bleiben Sets mit BESTÄTIGTER ` +
          'Fehlanzeige UND solche, die Bild samt Vorschau schon lokal haben',
      );
      assert.equal(
        d.skipped,
        1,
        `skipped=${d.skipped} statt 1 — die Rückmeldung soll nennen, wie viele ` + 'schon fertig waren',
      );

      // “Can you adapt the logic so that it deletes the image_misses and
      // tries them again? Currently there are very many entries in the
      // table." — The many entries are the bug from an earlier round:
      // every network hiccup counted as “does not exist".
      assert.equal(
        d.verworfen,
        1,
        `verworfen=${d.verworfen} statt 1 — genau die Fehlanzeige ohne Grund ` + 'gehört zurückgenommen',
      );
      assert.equal(
        (await db.get(`SELECT COUNT(*)::int c FROM image_misses WHERE cache_key = $1`, [`set:${P}_3`])).c,
        1,
        'Der bestätigte 404 wurde mitgelöscht. Für alte Sets hat der CDN meist ' +
          'kein Bild — die alle erneut zu holen wäre ein halber Tag reiner ' +
          '404-Verkehr, und beim nächsten Klick wieder.',
      );
      assert.equal(
        (await db.get(`SELECT COUNT(*)::int c FROM image_misses WHERE cache_key = $1`, [`set:${P}_4`])).c,
        0,
        'Die grundlose Fehlanzeige steht noch — dann bleibt das Bild weitere ' +
          'sieben Tage aus, obwohl nie etwas an ihm war',
      );
      assert.ok(d.dauer_minuten >= 0, 'Die Dauerabschätzung fehlt');
    });

    await t.test('a second click does not requeue anything finished', async () => {
      // The actual finding: after a full pass every click brought
      // the whole catalog back into the queue. The job processed that
      // correctly (file present → skip), but the tile showed
      // tens of thousands of open images, and every note cost a pass.
      await db.run(`DELETE FROM image_wanted`);
      const extra = [];
      for (let i = 1; i <= 10; i++) {
        for (const suf of ['.jpg', '_thumb.jpg']) {
          const f = path.join(SET_IMAGES_DIR, `${P}_${i}${suf}`);
          try {
            fs.writeFileSync(f, 'x', { flag: 'wx' });
            extra.push(f);
          } catch (e) {
            if (e.code !== 'EEXIST') throw e;
          }
        }
      }
      try {
        const d = await (await fetch(`${base}/api/v1/admin/catalog-images`, { method: 'POST' })).json();
        assert.equal(d.queued, 0, `${d.queued} eingereiht, obwohl alles fertig ist — genau Marcos Befund`);
        assert.equal(d.pending, 0, 'Die Warteschlange darf leer bleiben');
      } finally {
        for (const f of extra) fs.rmSync(f, { force: true });
        // Bring the queue back into its initial state — the
        // substep below processes it and needs it filled.
        await (await fetch(`${base}/api/v1/admin/catalog-images`, { method: 'POST' })).json();
      }
    });

    await t.test('the job only fetches what is missing', async () => {
      const IQ = _req('src/images/imageDemandRun.js');
      let n = 0;
      // `.gesamt` = processed notes (loaded, preview created or
      // skipped). Since an earlier round the pass delivers a
      // breakdown instead of a bare number — otherwise the job was silent
      // exactly when it only skips.
      for (let i = 0; i < 3; i++) n += (await IQ._workStack()).gesamt;
      assert.equal(
        geladen,
        7,
        `${geladen} Downloads statt 7 — bereits vorhandene Bilder dürfen nicht ` + 'erneut geholt werden',
      );
      assert.ok(n >= 8, `nur ${n} Aufträge abgearbeitet`);
    });

    await t.test('missing previews are caught up, existing ones are not', async () => {
      // Marco's second question. For images stored before the background job,
      // the preview may be missing.
      assert.ok(verkleinert.includes(`/images/sets/${P}_1.jpg`), 'Das vorhandene Bild ohne Vorschau bekommt keine');
      assert.ok(
        !verkleinert.includes(`/images/sets/${P}_2.jpg`),
        'Für ein Bild mit vorhandener Vorschau wird erneut gerechnet',
      );
      // And every freshly fetched image gets one.
      assert.equal(
        verkleinert.length,
        geladen + 1,
        `${verkleinert.length} Vorschauen bei ${geladen} Downloads + 1 nachgeholter`,
      );
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
        await fetch(`${base}/api/v1/admin/catalog-images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alle_erneut: true }),
        })
      ).json();
      assert.equal(d.success, true);
      assert.equal(
        (await db.get(`SELECT COUNT(*)::int c FROM image_misses WHERE cache_key = $1`, [`set:${P}_3`])).c,
        0,
        'Mit alle_erneut muss auch der bestätigte 404 zurückgenommen werden',
      );
    });
  } finally {
    for (const f of dateien) fs.rmSync(path.join(SET_IMAGES_DIR, f), { force: true });
    await db.run(`DELETE FROM rb_sets WHERE set_num LIKE $1`, [P + '%']).catch(() => {});
    await db.run(`DELETE FROM image_wanted`).catch(() => {});
    await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']).catch(() => {});
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});

test('the button is wired in the tile', () => {
  // Without registration a click does nothing — and that only shows on the device.
  const core = require('./helpers/sources').coreSource();
  assert.match(core, /data-click="queueCatalogImages"/, 'Der Knopf fehlt in der Kachel');
  const admin = require('./helpers/sources').adminSource();
  assert.match(admin, /export async function queueCatalogImages/, 'Kein Klick-Handler');
  assert.match(admin, /^\s+queueCatalogImages,$/m, 'Der Handler ist nicht in der Aktions-Liste registriert');
  for (const loc of ['de', 'en']) {
    const l = fs.readFileSync(path.join(ROOT, 'public', 'locales', `${loc}.js`), 'utf8');
    assert.match(l, /'monitor\.catalog_images':/, `Beschriftung fehlt in ${loc}`);
    assert.match(l, /'monitor\.catalog_images_queued':/, `Rückmeldung fehlt in ${loc}`);
    // Second version for the case that something was already present: without it
    // “0 images in the queue" would look like a failure although
    // it is the best of all messages.
    assert.match(l, /'monitor\.catalog_images_queued_skipped':/, `Rückmeldung für „schon vorhanden" fehlt in ${loc}`);
    // The button now takes back miss markers and estimates the
    // duration. Without both numbers it would stay unclear why images are suddenly
    // pending again that last counted as missing — and whether that takes minutes or
    // hours.
    assert.match(
      l,
      /'monitor\.catalog_images_retried':/,
      `Rückmeldung für zurückgenommene Fehlanzeigen fehlt in ${loc}`,
    );
    assert.match(l, /'monitor\.catalog_images_eta':/, `Dauerabschätzung fehlt in ${loc}`);
  }
});
