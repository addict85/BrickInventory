/**
 * The image follow-up run covers ALL image kinds — and catches up on missing previews,
 * not only missing files.
 *
 * Counter-check (performed): `/images/sets/` removed from _fsPathFromLocal →
 * thumbs stays 0 and the file is not created.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without DB: skip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { holdsSet, catalogSet } = require('./helpers/inventory');
const db = testData();

test('the follow-up run creates missing previews — also for set images', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;

  const { Jimp } = require(path.join(ROOT, 'node_modules', 'jimp'));
  const { DATA_DIR } = _req('src/infra/appPaths.js');
  const ordner = path.join(DATA_DIR, 'images', 'sets');
  fs.mkdirSync(ordner, { recursive: true });

  const name = `zz-redl-${process.pid}`;
  const original = path.join(ordner, `${name}.jpg`);
  const preview = path.join(ordner, `${name}_thumb.jpg`);
  await new Jimp({ width: 600, height: 400, color: 0x00ff00ff }).write(original);
  fs.rmSync(preview, { force: true });

  const USER = `redltest-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username=$1`, [USER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [USER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [USER])).id;
  await db.run(`DELETE FROM sets WHERE set_number=$1`, [name]);
  await db.run(`DELETE FROM set_catalog WHERE set_number=$1`, [name]);
  await holdsSet(db, uid, name, 1);
  // Since migration 0033 the image path is in the catalog — and exactly from there
  // the follow-up run (src/catalog/partsEnrichment.ts) collects the paths.
  await catalogSet(db, name, { name: 'Test', image_local: `/images/sets/${name}.jpg` });

  try {
    const { redownloadMissingImages } = _req('src/catalog/partsEnrichment.js');
    const r = await redownloadMissingImages();

    assert.ok(r && typeof r.thumbs === 'number', 'the run must report how many previews it created');
    assert.ok(
      r.thumbs >= 1,
      'the missing preview of the SET image was not created — probably ' +
        '_fsPathFromLocal() again drops everything except /images/parts/',
    );
    assert.ok(fs.existsSync(preview), 'the preview file is missing');
    assert.ok(fs.statSync(preview).size < fs.statSync(original).size, 'the preview must be smaller than the original');
  } finally {
    await db.run(`DELETE FROM users WHERE username=$1`, [USER]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [name]).catch(() => {});
    fs.rmSync(original, { force: true });
    fs.rmSync(preview, { force: true });
    await db.pool.end().catch(() => {});
  }
});

test('the path resolver knows all three image kinds', () => {
  const src = fs
    .readFileSync(path.join(ROOT, 'src/catalog/reloadImages.ts'), 'utf8')
    .split('\n')
    .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');
  const fn = src.slice(src.indexOf('function _fsPathFromLocal'));
  for (const kind of ['/images/parts/', '/images/minifigs/', '/images/sets/']) {
    assert.ok(fn.includes(kind), `_fsPathFromLocal does not know ${kind} — these images silently drop out of the run`);
  }
  // The protection against path tricks must stay: the value comes from the database.
  assert.ok(/includes\('\.\.'\)/.test(fn), 'the check for .. is missing');
});

test('both preview generators report failures', () => {
  for (const [datei, muster] of /** @type {[string, RegExp][]} */ ([
    ['src/images/thumbs.ts', /\[thumb\]/],
    ['src/images/proxyThumbs.ts', /\[img-proxy\] Vorschau fehlgeschlagen/],
  ])) {
    const src = fs.readFileSync(path.join(ROOT, datei), 'utf8');
    assert.ok(
      muster.test(src),
      `${datei}: a failure of the preview generation stays silent. That is exactly what ` +
        'hid the .tmp bug from an earlier round for seven addenda',
    );
  }
});
