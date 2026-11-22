/**
 * Catalog images: the catalog search names the local image from set_catalog
 * (including preview) for every account — since migration 0105 set images are catalog.
 * The list triggers no image work in doing so — the image job does that.
 *
 * Counter-checks (measured on 10.11.2026):
 *   A  in catalogPage() (src/catalog/service.ts) resolveImageLocal() omitted
 *      → red: “… the preview takes precedence” (original path instead of _thumb)
 *   B  in katalogSuche.ts c.image_local removed from SET_SPALTEN → red: “the list
 *      names the image from set_catalog …” (undefined)
 *   C  in catalogPage() k.images.rememberUsed() per row → red: “the
 *      list triggers no image work”
 *   D  in catalogSet() image_local only for own sets (`set.owned ? … : null`)
 *      → red: “even a foreign account gets the local file”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
// Own storage so that the test puts no images into the working tree.
process.env.APP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'katalog-bilder-'));

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();

test('catalog images from set_catalog', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const NAME = `katalog-bild-${process.pid}`,
    FREMD = `katalog-fremd-${process.pid}`;
  const MIT = 'KB/1-1',
    OHNE = 'KB2-1';
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, FREMD]]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  const fremd = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [FREMD])).id;
  await db.run('INSERT INTO wanted (user_id, set_number) VALUES ($1, $2), ($1, $3)', [uid, MIT, OHNE]);
  await db.run('DELETE FROM rb_sets WHERE set_num = ANY($1)', [[MIT, OHNE]]);
  await db.run(
    `INSERT INTO rb_sets (set_num, name, year, num_parts, set_img_url)
                VALUES ($1,'Mit Bild',2001,10,'https://cdn.rebrickable.com/media/sets/kb1.jpg'), ($2,'Ohne Bild',2002,5,NULL)`,
    [MIT, OHNE],
  );
  await db.run(`INSERT INTO set_catalog (set_number, image_local) VALUES ($1, '/images/sets/KB_1-1.jpg'), ($2, NULL)`, [
    MIT,
    OHNE,
  ]);
  const ordner = path.join(process.env.APP_ROOT, 'data', 'images', 'sets');
  fs.mkdirSync(ordner, { recursive: true });
  fs.writeFileSync(path.join(ordner, 'KB_1-1.jpg'), 'JPG');
  fs.writeFileSync(path.join(ordner, 'KB_1-1_thumb.jpg'), 'JPG');

  const noted = require('./helpers/sources').imageNotes();
  const vorgemerkt = noted.notes;
  t.after(noted.ende);

  t.after(async () => {
    await db.run('DELETE FROM rb_sets WHERE set_num = ANY($1)', [[MIT, OHNE]]);
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, fremd]]);
    fs.rmSync(process.env.APP_ROOT, { recursive: true, force: true });
    await db.pool.end().catch(() => {});
  });

  const { catalogPage, catalogSet } = _req('src/catalog/service.js');

  const bilder = async wer =>
    Object.fromEntries(
      (await catalogPage(wer, { q: 'KB', themeId: null }, 'num_asc', 1, 60)).sets.map(s => [
        s.set_number,
        s.image_local,
      ]),
    );

  await t.test('the list names the image from set_catalog — and the preview takes precedence', async () => {
    const image = await bilder(uid);
    assert.equal(image[MIT], '/images/sets/KB_1-1_thumb.jpg', 'die Liste nennt das Bild; die Vorschau hat Vorrang');
    assert.equal(image[OHNE], null);
  });

  await t.test('a foreign account also gets the local file', async () => {
    assert.equal((await bilder(fremd))[MIT], '/images/sets/KB_1-1_thumb.jpg');
    assert.equal((await catalogSet(fremd, MIT)).image_local, '/images/sets/KB_1-1_thumb.jpg');
  });

  await t.test('the list triggers no image work', () => {
    assert.deepEqual(vorgemerkt, []);
  });

  await t.test('the detail takes the same file and loads nothing more', async () => {
    const set = await catalogSet(uid, MIT);
    assert.equal(set.image_local, '/images/sets/KB_1-1_thumb.jpg');
    const ohne = await catalogSet(uid, OHNE);
    assert.equal(ohne.image_local, null, 'ohne Adresse kein Abruf');
    assert.deepEqual(vorgemerkt, []);
  });
});
