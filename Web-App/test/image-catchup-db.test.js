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
  if (!(await dataOrSkip(t, _req, { migrieren: false }))) return;

  const { Jimp } = require(path.join(ROOT, 'node_modules', 'jimp'));
  const { DATA_DIR } = _req('src/infra/appPaths.js');
  const ordner = path.join(DATA_DIR, 'images', 'sets');
  fs.mkdirSync(ordner, { recursive: true });

  const name = `zz-redl-${process.pid}`;
  const original = path.join(ordner, `${name}.jpg`);
  const vorschau = path.join(ordner, `${name}_thumb.jpg`);
  await new Jimp({ width: 600, height: 400, color: 0x00ff00ff }).write(original);
  fs.rmSync(vorschau, { force: true });

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

    assert.ok(r && typeof r.thumbs === 'number', 'der Lauf muss melden, wie viele Vorschauen er erzeugt hat');
    assert.ok(
      r.thumbs >= 1,
      'die fehlende Vorschau des SET-Bildes wurde nicht erzeugt — vermutlich lässt ' +
        '_fsPathFromLocal() wieder alles ausser /images/parts/ fallen',
    );
    assert.ok(fs.existsSync(vorschau), 'die Vorschau-Datei fehlt');
    assert.ok(
      fs.statSync(vorschau).size < fs.statSync(original).size,
      'die Vorschau muss kleiner sein als das Original',
    );
  } finally {
    await db.run(`DELETE FROM users WHERE username=$1`, [USER]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [name]).catch(() => {});
    fs.rmSync(original, { force: true });
    fs.rmSync(vorschau, { force: true });
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
  for (const art of ['/images/parts/', '/images/minifigs/', '/images/sets/']) {
    assert.ok(fn.includes(art), `_fsPathFromLocal kennt ${art} nicht — diese Bilder fallen still aus dem Lauf`);
  }
  // The protection against path tricks must stay: the value comes from the database.
  assert.ok(/includes\('\.\.'\)/.test(fn), 'die Prüfung auf .. fehlt');
});

test('both preview generators report failures', () => {
  for (const [datei, muster] of /** @type {[string, RegExp][]} */ ([
    ['src/images/thumbs.ts', /\[thumb\]/],
    ['src/images/proxyThumbs.ts', /\[img-proxy\] Vorschau fehlgeschlagen/],
  ])) {
    const src = fs.readFileSync(path.join(ROOT, datei), 'utf8');
    assert.ok(
      muster.test(src),
      `${datei}: ein Fehlschlag der Vorschau-Erzeugung bleibt still. Genau das hat den ` +
        '.tmp-Fehler aus einer früheren Runde sieben Nachträge lang verdeckt',
    );
  }
});
