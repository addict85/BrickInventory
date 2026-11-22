/**
 * The image follow-up run covers ALL image kinds — and catches up on missing previews,
 * not only missing files.
 *
 * Counter-check (performed): `/images/sets/` removed from _fsPathFromLocal →
 * thumbs stays 0 and the file is not created.
 * Counter-checks (22.11.2026, each alone):
 *   A  `/images/parts/` removed from _fsPathFromLocal → red “the path resolver …” (no part preview)
 *   B  `/images/minifigs/` removed → red the same test (no minifigure preview)
 *   C  the `..` and `/` checks removed together → red the same test (preview outside created);
 *      either alone stays green, the other one catches `../`
 *   D  the console.error in previewFrom removed → red “both preview generators report failures”
 *   E  the console.error in createProxyPreview removed → red the same test
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
test.after(() => db.pool.end().catch(() => {}));

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

    assert.ok(r && typeof r.thumbs === 'number', 'der Lauf muss melden, wie viele Vorschauen er erzeugt hat');
    assert.ok(
      r.thumbs >= 1,
      'die fehlende Vorschau des SET-Bildes wurde nicht erzeugt — vermutlich lässt ' +
        '_fsPathFromLocal() wieder alles ausser /images/parts/ fallen',
    );
    assert.ok(fs.existsSync(preview), 'die Vorschau-Datei fehlt');
    assert.ok(
      fs.statSync(preview).size < fs.statSync(original).size,
      'die Vorschau muss kleiner sein als das Original',
    );
  } finally {
    await db.run(`DELETE FROM users WHERE username=$1`, [USER]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [name]).catch(() => {});
    fs.rmSync(original, { force: true });
    fs.rmSync(preview, { force: true });
  }
});

test('the path resolver knows all three image kinds, and no path tricks', { concurrency: 1 }, async t => {
  // Part and figure images without a preview get one in the same run; a `..` from the database is skipped.
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;
  const { Jimp } = require(path.join(ROOT, 'node_modules', 'jimp'));
  const { DATA_DIR } = _req('src/infra/appPaths.js');
  const P = process.pid;
  const files = {
    part: [path.join(DATA_DIR, 'images', 'parts', `zzp${P}_4.jpg`), `/images/parts/zzp${P}_4.jpg`],
    fig: [path.join(DATA_DIR, 'images', 'minifigs', `zzf${P}.jpg`), `/images/minifigs/zzf${P}.jpg`],
  };
  const outside = path.join(DATA_DIR, 'images', `zzo${P}.jpg`);
  for (const f of [files.part[0], files.fig[0], outside]) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    await new Jimp({ width: 600, height: 400, color: 0x0000ffff }).write(f);
  }
  const thumb = f => f.replace(/\.jpg$/, '_thumb.jpg');
  t.after(async () => {
    for (const f of [files.part[0], files.fig[0], outside])
      for (const x of [f, thumb(f)]) fs.rmSync(x, { force: true });
    await db
      .run('DELETE FROM part_color_catalog WHERE part_number = ANY($1)', [[`zzp${P}`, `zzo${P}`]])
      .catch(() => {});
    await db.run('DELETE FROM minifigs_catalog WHERE fig_number = $1', [`zzf${P}`]).catch(() => {});
  });
  const cdn = 'https://cdn.rebrickable.com/media/x.jpg';
  await db.run(`INSERT INTO part_color_catalog (part_number, color_id, image_url, image_local) VALUES ($1,4,$2,$3)`, [
    `zzp${P}`,
    cdn,
    files.part[1],
  ]);
  await db.run(`INSERT INTO part_color_catalog (part_number, color_id, image_url, image_local) VALUES ($1,4,$2,$3)`, [
    `zzo${P}`,
    cdn,
    `/images/parts/../zzo${P}.jpg`,
  ]);
  await db.run(`INSERT INTO minifigs_catalog (fig_number, image_url, image_local) VALUES ($1,$2,$3)`, [
    `zzf${P}`,
    cdn,
    files.fig[1],
  ]);
  const { redownloadMissingImages } = _req('src/catalog/partsEnrichment.js');
  await redownloadMissingImages();
  assert.ok(fs.existsSync(thumb(files.part[0])), 'no preview for the part image');
  assert.ok(fs.existsSync(thumb(files.fig[0])), 'no preview for the minifigure image');
  assert.equal(fs.existsSync(thumb(outside)), false, 'a path with .. was followed');
});

test('both preview generators report failures', async t => {
  // A broken source must leave a trace in the log, not a silent false.
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-thumbfail-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // A readable header with a cut-off body: the dimension check passes, decoding fails.
  const { Jimp } = require(path.join(ROOT, 'node_modules', 'jimp'));
  const whole = path.join(dir, 'ganz.jpg');
  await new Jimp({ width: 300, height: 200, color: 0xff0000ff }).write(whole);
  const broken = path.join(dir, 'kaputt.jpg');
  const bytes = fs.readFileSync(whole);
  fs.writeFileSync(broken, bytes.subarray(0, Math.floor(bytes.length / 3)));
  const lines = [];
  t.mock.method(console, 'error', (...a) => lines.push(a.join(' ')));
  const { DATA_DIR } = _req('src/infra/appPaths.js');
  const local = path.join(DATA_DIR, 'images', 'sets', `zzk${process.pid}.jpg`);
  fs.mkdirSync(path.dirname(local), { recursive: true });
  fs.copyFileSync(broken, local);
  t.after(() => fs.rmSync(local, { force: true }));
  await _req('src/images/thumbs.js').previewFrom(`/images/sets/zzk${process.pid}.jpg`);
  // The preview lock holds its own connection open; recorded so that the test can close it.
  const access = require('./helpers/sources').testAccess();
  const connect = access.ownConnection;
  t.mock.method(access, 'ownConnection', async () => {
    const c = await connect.call(access);
    t.after(() => c.end().catch(() => {}));
    return c;
  });
  const { createProxyPreview } = _req('src/images/proxyThumbs.js');
  assert.equal(await createProxyPreview(broken, path.join(dir, 'kaputt_thumb.jpg')), false);
  assert.ok(
    lines.some(z => z.startsWith('[thumb]')),
    `previewFrom stays silent: ${lines.join(' | ')}`,
  );
  assert.ok(
    lines.some(z => z.startsWith('[img-proxy] Vorschau fehlgeschlagen')),
    `the proxy preview stays silent: ${lines.join(' | ')}`,
  );
});
