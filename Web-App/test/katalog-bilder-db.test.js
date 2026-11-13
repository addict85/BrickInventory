/**
 * Katalog-Bilder: Die Katalogsuche nennt das lokale Bild aus set_catalog
 * (samt Vorschau) für jedes Konto — Set-Bilder sind seit Migration 0105 Katalog.
 * Die Liste stösst dabei keine Bildarbeit an — das macht der Bild-Job.
 *
 * Gegenproben (am 10.11.2026 gemessen):
 *   A  in katalogSeite() (src/katalog/dienst.ts) resolveImageLocal() weggelassen
 *      → rot: „… die Vorschau hat Vorrang“ (Originalpfad statt _thumb)
 *   B  in katalogSuche.ts c.image_local aus SET_SPALTEN entfernt → rot: „die Liste
 *      nennt das Bild aus set_catalog …“ (undefined)
 *   C  in katalogSeite() je Zeile k.nacharbeit.bildVormerken() → rot: „die
 *      Liste stösst keine Bildarbeit an“
 *   D  in katalogSet() image_local nur für eigene Sets (`set.owned ? … : null`)
 *      → rot: „auch ein fremdes Konto bekommt die lokale Datei“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
// Eigene Ablage, damit der Test keine Bilder in den Arbeitsbaum legt.
process.env.APP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'katalog-bilder-'));

const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const db = testDaten();

test('Katalog-Bilder aus set_catalog', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;

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

  const nacharbeit = _req('src/infra/bereich.js').prozessDienste().katalog.nacharbeit;
  const vorgemerkt = [];
  const vorher = nacharbeit.bildVormerken;
  nacharbeit.bildVormerken = (_url, sn) => vorgemerkt.push(sn);
  t.after(() => {
    nacharbeit.bildVormerken = vorher;
  });

  t.after(async () => {
    await db.run('DELETE FROM rb_sets WHERE set_num = ANY($1)', [[MIT, OHNE]]);
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, fremd]]);
    fs.rmSync(process.env.APP_ROOT, { recursive: true, force: true });
    await db.pool.end().catch(() => {});
  });

  const { katalogSeite, katalogSet } = _req('src/katalog/dienst.js');

  const bilder = async wer =>
    Object.fromEntries(
      (await katalogSeite(wer, { q: 'KB', themeId: null }, 'num_asc', 1, 60)).sets.map(s => [
        s.set_number,
        s.image_local,
      ]),
    );

  await t.test('die Liste nennt das Bild aus set_catalog — und die Vorschau hat Vorrang', async () => {
    const bild = await bilder(uid);
    assert.equal(bild[MIT], '/images/sets/KB_1-1_thumb.jpg', 'die Liste nennt das Bild; die Vorschau hat Vorrang');
    assert.equal(bild[OHNE], null);
  });

  await t.test('auch ein fremdes Konto bekommt die lokale Datei', async () => {
    assert.equal((await bilder(fremd))[MIT], '/images/sets/KB_1-1_thumb.jpg');
    assert.equal((await katalogSet(fremd, MIT)).image_local, '/images/sets/KB_1-1_thumb.jpg');
  });

  await t.test('die Liste stösst keine Bildarbeit an', () => {
    assert.deepEqual(vorgemerkt, []);
  });

  await t.test('das Detail nimmt dieselbe Datei und lädt nichts nach', async () => {
    const set = await katalogSet(uid, MIT);
    assert.equal(set.image_local, '/images/sets/KB_1-1_thumb.jpg');
    const ohne = await katalogSet(uid, OHNE);
    assert.equal(ohne.image_local, null, 'ohne Adresse kein Abruf');
    assert.deepEqual(vorgemerkt, []);
  });
});
