/**
 * Was ein Konto eintippt, ist im gemeinsamen Katalog nur ein Platzhalter:
 * Ein anderes Konto fragt trotzdem Rebrickable, und dessen Antwort ersetzt
 * ihn. Eingetippte Bilder kommen nur von den Hosts, die der Bild-Proxy zeigt.
 *
 * Gegenproben (am 28.10.2026 gemessen, je eine Änderung, danach zurück):
 *   A  in mitHerkunft() `ersetzt` immer falsch (`… AND FALSE`) → rot: „ein
 *      anderes Konto ersetzt den Platzhalter …“, „eine spätere Eingabe …“
 *      und „Figuren: …“
 *   B  in katalogTeil() Name, Kategorie und Bild ohne Herkunftsfilter → rot:
 *      „ein anderes Konto ersetzt den Platzhalter …“ (kein Abruf). Nur der
 *      Name allein bleibt grün: Annas Bild löst den Abruf schon aus.
 *   C  bildEingabe() gibt jede URL zurück → rot: „ein fremder Bild-Host …“
 *   D  in addManualPartIntern die Eingabe ohne `uid` geschrieben → rot:
 *      „die Eingabe steht als Platzhalter …“
 *
 * REQUIRE_DB=1.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const db   = _req('db/database.js');

// Rebrickable vorgeben, bevor die Routen die Funktionen herausziehen (wie in
// test/katalog-vor-rebrickable-db.test.js).
const rbPfad = require.resolve(path.join(ROOT, 'dist', 'clients', 'rebrickable.js'));
const echtRb = require(rbPfad);
let abrufe = [];
require.cache[rbPfad].exports = Object.assign({}, echtRb, {
  lookupPart: async (nr) => {
    abrufe.push(`lookupPart ${nr}`);
    return { part_name: 'Brick 2 x 4', category_name: 'Bricks',
             image_url: 'https://cdn.rebrickable.com/media/parts/3001.jpg' };
  },
  getMinifigInfo: async (nr) => {
    abrufe.push(`getMinifigInfo ${nr}`);
    return { fig_number: nr, fig_name: 'Chewbacca',
             image_url: 'https://cdn.rebrickable.com/media/sets/fig.jpg' };
  },
});

test.after(async () => { await db.pool.end().catch(() => {}); });

test('der gemeinsame Katalog', { concurrency: 1 }, async (t) => {
  try { await db.get('SELECT 1'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  {
    const c = await db.pool.connect();
    try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  }

  const neu = async (name) => (await db.get(
    `INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [name])).id;
  const A = await neu('anna'), B = await neu('bruno');

  const { addManualPart } = _req('routes/parts.js');
  const { addManualFig }  = _req('routes/minifigs.js');
  const teil = (nr) => db.get(
    `SELECT pc.part_name, pc.name_von, pcc.image_url, pcc.bild_von
       FROM part_catalog pc LEFT JOIN part_color_catalog pcc
         ON pcc.part_number = pc.part_number AND pcc.color_id = 4
      WHERE pc.part_number = $1`, [nr]);

  await t.test('die Eingabe steht als Platzhalter mit ihrem Konto da', async () => {
    abrufe = [];
    await addManualPart(A, { part_number: '3001', color_id: 4, quantity: 1,
      part_name: 'Annas Name', image_url: 'https://cdn.rebrickable.com/media/anna.jpg' });
    assert.deepEqual(abrufe, [], 'mit Namen wird nicht nachgeschlagen');
    const z = await teil('3001');
    assert.equal(z.part_name, 'Annas Name');
    assert.equal(z.name_von, A);
    assert.equal(z.bild_von, A);
  });

  await t.test('ein anderes Konto ersetzt den Platzhalter durch Rebrickable', async () => {
    abrufe = [];
    await addManualPart(B, { part_number: '3001', color_id: 4, quantity: 1 });
    assert.deepEqual(abrufe, ['lookupPart 3001'], 'Annas Eingabe zählt für Bruno nicht als bekannt');
    const z = await teil('3001');
    assert.equal(z.part_name, 'Brick 2 x 4');
    assert.equal(z.name_von, null);
    assert.equal(z.image_url, 'https://cdn.rebrickable.com/media/parts/3001.jpg');
    assert.equal(z.bild_von, null);
  });

  await t.test('eine spätere Eingabe ändert den geprüften Wert nicht', async () => {
    await addManualPart(A, { part_number: '3001', color_id: 4, quantity: 1, part_name: 'Neuer Name' });
    assert.equal((await teil('3001')).part_name, 'Brick 2 x 4');
  });

  await t.test('ein fremder Bild-Host kommt nicht in den Katalog', async () => {
    await addManualPart(A, { part_number: '3002', color_id: 4, quantity: 1,
      part_name: 'Mit Zählpixel', image_url: 'https://zaehler.example/pixel.png' });
    const z = await teil('3002');
    assert.equal(z.part_name, 'Mit Zählpixel');
    assert.equal(z.image_url ?? null, null);
  });

  await t.test('Figuren: der Platzhalter weicht der geprüften Quelle', async () => {
    await addManualFig(A, { fig_number: 'sw0011', quantity: 1, fig_name: 'Annas Figur' });
    abrufe = [];
    await addManualFig(B, { fig_number: 'sw0011', quantity: 1 });
    assert.deepEqual(abrufe, ['getMinifigInfo sw0011']);
    const z = await db.get('SELECT fig_name, name_von FROM minifigs_catalog WHERE fig_number = $1', ['sw0011']);
    assert.equal(z.fig_name, 'Chewbacca');
    assert.equal(z.name_von, null);
  });
});
