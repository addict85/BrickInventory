/**
 * Katalog-Bilder: Eine schon heruntergeladene Datei gilt für jedes Konto.
 * downloadSetImage() legt Set-Bilder unter images/sets/<setnummer>.jpg ab,
 * benannt nach der Setnummer allein; der Katalog nimmt sie (samt Vorschau),
 * auch für Sets, die das fragende Konto nicht besitzt. Die Liste stösst dabei
 * keine Bildarbeit an — das macht der Bild-Job über den Proxy.
 *
 * Gegenproben (am 29.10.2026 gemessen):
 *   A  in src/katalog/dienst.ts lokalesBild() ohne die Bereinigung der
 *      Setnummer (`KB/1-1` statt `KB_1-1`) → rot: „die Liste findet die Datei“
 *   B  resolveIfExists() ohne Vorschau (gibt den Originalpfad zurück) → rot:
 *      „die Vorschau hat Vorrang“
 *   C  in katalogSeite() je Zeile nacharbeit().bildVormerken() → rot: „die
 *      Liste stösst keine Bildarbeit an“
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

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

test('Katalog-Bilder gelten für jedes Konto', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const NAME = `katalog-bild-${process.pid}`;
  const MIT = 'KB/1-1', OHNE = 'KB2-1';
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  await db.run('DELETE FROM rb_sets WHERE set_num = ANY($1)', [[MIT, OHNE]]);
  await db.run(`INSERT INTO rb_sets (set_num, name, year, num_parts, set_img_url)
                VALUES ($1,'Mit Bild',2001,10,'https://cdn.rebrickable.com/media/sets/kb1.jpg'), ($2,'Ohne Bild',2002,5,NULL)`, [MIT, OHNE]);
  const ordner = path.join(process.env.APP_ROOT, 'data', 'images', 'sets');
  fs.mkdirSync(ordner, { recursive: true });
  fs.writeFileSync(path.join(ordner, 'KB_1-1.jpg'), 'JPG');
  fs.writeFileSync(path.join(ordner, 'KB_1-1_thumb.jpg'), 'JPG');

  const nacharbeit = _req('src/auftraege/nacharbeit.js');
  const vorgemerkt = [];
  nacharbeit.verdrahteNacharbeit({ ...nacharbeit.nacharbeit(), bildVormerken: (url, sn) => vorgemerkt.push(sn) });

  t.after(async () => {
    await db.run('DELETE FROM rb_sets WHERE set_num = ANY($1)', [[MIT, OHNE]]);
    await db.run('DELETE FROM users WHERE id=$1', [uid]);
    fs.rmSync(process.env.APP_ROOT, { recursive: true, force: true });
    await db.pool.end().catch(() => {});
  });

  const { katalogSeite, katalogSet } = _req('src/katalog/dienst.js');

  await t.test('die Liste findet die Datei, auch ohne Besitz — und die Vorschau hat Vorrang', async () => {
    const seite = await katalogSeite(uid, { q: 'KB', themeId: null }, 'num_asc', 1, 60);
    const bild = Object.fromEntries(seite.sets.map(s => [s.set_number, s.image_local]));
    assert.equal(bild[MIT], '/images/sets/KB_1-1_thumb.jpg', 'die Liste findet die Datei; die Vorschau hat Vorrang');
    assert.equal(bild[OHNE], null);
    assert.equal(seite.sets.find(s => s.set_number === MIT).owned, false);
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
