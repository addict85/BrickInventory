/**
 * The hourly image follow-up (src/catalog/imageFollowUp.ts) gives manual parts and minifigures a
 * preview too: a file already on disk is entered into the catalog and shrunk at once.
 *
 * Counter-checks (22.11.2026, each alone):
 *   A  createPreview(local) deleted in the parts loop → red “parts” (no preview for the part)
 *   B  createPreview(local) deleted in the minifigure loop → red “minifigures”
 *   C  minifigsWithoutImage() only for source='manual' → red “every owned minifigure …” (set figure missing)
 *   D  minifigsWithoutImage() without the EXISTS on the holding → red the same test (unowned figure listed)
 *   E  holdingMinifigImagesOpen() without the EXISTS → red the same test (monitoring counts 3, the run 2)
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testData, testImageWorker } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

const shrunk = [];
testImageWorker(null, {
  createPreview: async p => {
    shrunk.push(p);
    return true;
  },
});

const P = process.pid;
const PART = `ifp${P}`,
  FIG = `fig-ifp${P}`,
  SETFIG = `fig-ifs${P}`,
  NOBODY = `fig-ifn${P}`;

test('image follow-up: manual parts and minifigures get a preview', { concurrency: 1 }, async t => {
  const db = testData();
  if (!(await dataOrSkip(t, _req))) return;
  const { PART_IMAGES_DIR, MINIFIG_IMAGES_DIR } = _req('src/infra/appPaths.js');
  const files = [path.join(PART_IMAGES_DIR, `${PART}_4.jpg`), path.join(MINIFIG_IMAGES_DIR, `${FIG}_0.jpg`)];
  const weg = async () => {
    for (const f of files) fs.rmSync(f, { force: true });
    await db.run('DELETE FROM users WHERE username = $1', [`ifp-${P}`]);
    await db.run('DELETE FROM part_color_catalog WHERE part_number = $1', [PART]);
    await db.run('DELETE FROM minifigs_catalog WHERE fig_number = ANY($1)', [[FIG, SETFIG, NOBODY]]);
  };
  await weg();
  t.after(async () => {
    await weg().catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [`ifp-${P}`]))
    .id;
  await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1,$2,4,'manual')`, [uid, PART]);
  await db.run(`INSERT INTO part_color_catalog (part_number, color_id, image_url) VALUES ($1,4,$2)`, [
    PART,
    `https://cdn.rebrickable.com/media/parts/${PART}.jpg`,
  ]);
  await db.run(`INSERT INTO minifigs (user_id, fig_number, source) VALUES ($1,$2,'manual')`, [uid, FIG]);
  await db.run(`INSERT INTO minifigs_catalog (fig_number, image_url) VALUES ($1,$2)`, [
    FIG,
    `https://cdn.rebrickable.com/media/sets/${FIG}.jpg`,
  ]);
  // A figure from a set is loaded too; one nobody owns is not.
  await db.run(`INSERT INTO sets (user_id, set_number) VALUES ($1,$2)`, [uid, `7${P}-1`]);
  await db.run(`INSERT INTO minifigs (user_id, set_number, fig_number, source) VALUES ($1,$2,$3,'set')`, [
    uid,
    `7${P}-1`,
    SETFIG,
  ]);
  for (const f of [SETFIG, NOBODY])
    await db.run(`INSERT INTO minifigs_catalog (fig_number, image_url) VALUES ($1,$2)`, [
      f,
      `https://cdn.rebrickable.com/media/sets/${f}.jpg`,
    ]);

  await t.test('every owned minifigure without a local image is loaded, and monitoring counts the same', async () => {
    const { imagesForFollowUp } = _req('src/catalog/imageState.js');
    const figs = (await imagesForFollowUp()).minifigs.map(f => f.fig_number);
    assert.deepEqual(
      [FIG, SETFIG, NOBODY].filter(f => figs.includes(f)),
      [FIG, SETFIG],
    );
    const open = await require('./helpers/sources').testContext('management').management.holdingMinifigImagesOpen();
    assert.equal(open, figs.length);
    // Only the files below are local; the run must not reach the network.
    await db.run('DELETE FROM minifigs_catalog WHERE fig_number = ANY($1)', [[SETFIG, NOBODY]]);
  });

  // The files are there already: the download is skipped, only the follow-up can trigger the preview.
  for (const f of files) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, 'x');
  }
  const { imageFollowUp } = _req('src/catalog/imageFollowUp.js');
  await imageFollowUp({ progress: async () => {}, ended: false });
  // The preview runs in the background (not awaited by the job).
  await new Promise(r => setImmediate(r));

  await t.test('parts', async () => {
    assert.ok(shrunk.includes(`/images/parts/${PART}_4.jpg`), shrunk.join(', '));
    const z = await db.get('SELECT image_local FROM part_color_catalog WHERE part_number = $1 AND color_id = 4', [
      PART,
    ]);
    assert.equal(z.image_local, `/images/parts/${PART}_4.jpg`);
  });
  await t.test('minifigures', async () => {
    assert.ok(shrunk.includes(`/images/minifigs/${FIG}_0.jpg`), shrunk.join(', '));
  });
});
