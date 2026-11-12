/**
 * Was ein Konto eintippt, gehört ihm (teil_eigen, teil_farbe_eigen,
 * figur_eigen) und nie dem gemeinsamen Katalog: Ein anderes Konto zählt es
 * nicht als bekannt und fragt Rebrickable; der geprüfte Wert hat Vorrang.
 * Eingetippte Bilder kommen nur von den Hosts, die der Bild-Proxy zeigt.
 *
 * Gegenproben (am 03.11.2026 gemessen, je eine Änderung, danach zurück):
 *   A  merkeTeil()/merkeTeilFarbe()/merkeFigur() ohne den Zweig für `von`
 *      (Eingabe in den gemeinsamen Katalog) → rot: alle fünf Teiltests
 *   B  teilAusKatalog() verbindet teil_eigen und teil_farbe_eigen ohne
 *      `user_id = $3` → rot: „ein anderes Konto fragt trotzdem Rebrickable“
 *      und „der geprüfte Wert hat Vorrang …“ (nur der Name allein bleibt
 *      grün: Annas Bild fehlt Bruno und löst den Abruf schon aus)
 *   C  bildEingabe() gibt jede URL zurück → rot: „ein fremder Bild-Host …“
 *
 * REQUIRE_DB=1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = _req('db/database.js');

// Rebrickable vorgeben, bevor die Routen die Funktionen herausziehen (wie in
// test/katalog-vor-rebrickable-db.test.js).
const rbPfad = require.resolve(path.join(ROOT, 'dist', 'clients/rebrickable.js'));
const echtRb = require(rbPfad);
let abrufe = [];
require.cache[rbPfad].exports = Object.assign({}, echtRb, {
  lookupPart: async nr => {
    abrufe.push(`lookupPart ${nr}`);
    return {
      part_name: 'Brick 2 x 4',
      category_name: 'Bricks',
      image_url: 'https://cdn.rebrickable.com/media/parts/3001.jpg',
    };
  },
  getMinifigInfo: async nr => {
    abrufe.push(`getMinifigInfo ${nr}`);
    return { fig_number: nr, fig_name: 'Chewbacca', image_url: 'https://cdn.rebrickable.com/media/sets/fig.jpg' };
  },
});

test.after(async () => {
  await db.pool.end().catch(() => {});
});

test('der gemeinsame Katalog', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    keineDb(t, e);
    return;
  }

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }

  const neu = async name =>
    (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [name])).id;
  const A = await neu('anna'),
    B = await neu('bruno');

  const { addManualPart } = _req('src/teile/manuelleTeile.js');
  const { addManualFig } = _req('src/figuren/manuelleFiguren.js');
  const { katalogTeil } = _req('src/katalog/katalogPflege.js');
  const gemeinsam = nr =>
    db.get(
      `SELECT pc.part_name, pcc.image_url
       FROM (SELECT $1::text AS nr) q
       LEFT JOIN part_catalog pc ON pc.part_number = q.nr
       LEFT JOIN part_color_catalog pcc ON pcc.part_number = q.nr AND pcc.color_id = 4`,
      [nr],
    );
  const eigen = (uid, nr) =>
    db.get(
      `SELECT te.part_name, tfe.image_url
       FROM (SELECT $1::int AS u, $2::text AS nr) q
       LEFT JOIN teil_eigen te ON te.user_id = q.u AND te.part_number = q.nr
       LEFT JOIN teil_farbe_eigen tfe ON tfe.user_id = q.u AND tfe.part_number = q.nr AND tfe.color_id = 4`,
      [uid, nr],
    );

  await t.test('die Eingabe steht in den eigenen Angaben, nicht im gemeinsamen Katalog', async () => {
    abrufe = [];
    await addManualPart(A, {
      part_number: '3001',
      color_id: 4,
      quantity: 1,
      part_name: 'Annas Name',
      image_url: 'https://cdn.rebrickable.com/media/anna.jpg',
    });
    assert.deepEqual(abrufe, [], 'mit Namen wird nicht nachgeschlagen');
    assert.deepEqual(
      { ...(await eigen(A, '3001')) },
      { part_name: 'Annas Name', image_url: 'https://cdn.rebrickable.com/media/anna.jpg' },
    );
    assert.deepEqual({ ...(await gemeinsam('3001')) }, { part_name: null, image_url: null });
  });

  await t.test('ein anderes Konto fragt trotzdem Rebrickable', async () => {
    abrufe = [];
    await addManualPart(B, { part_number: '3001', color_id: 4, quantity: 1 });
    assert.deepEqual(abrufe, ['lookupPart 3001'], 'Annas Eingabe zählt für Bruno nicht als bekannt');
    assert.deepEqual(
      { ...(await gemeinsam('3001')) },
      { part_name: 'Brick 2 x 4', image_url: 'https://cdn.rebrickable.com/media/parts/3001.jpg' },
    );
    assert.equal((await katalogTeil('3001', 4, B)).name, 'Brick 2 x 4');
  });

  await t.test('der geprüfte Wert hat Vorrang, die eigene Angabe bleibt erhalten', async () => {
    await addManualPart(A, { part_number: '3001', color_id: 4, quantity: 1, part_name: 'Neuer Name' });
    assert.equal((await katalogTeil('3001', 4, A)).name, 'Brick 2 x 4');
    assert.equal((await gemeinsam('3001')).part_name, 'Brick 2 x 4');
    assert.equal((await eigen(A, '3001')).part_name, 'Annas Name');
  });

  await t.test('ein fremder Bild-Host kommt nicht in die eigenen Angaben', async () => {
    await addManualPart(A, {
      part_number: '3002',
      color_id: 4,
      quantity: 1,
      part_name: 'Mit Zählpixel',
      image_url: 'https://zaehler.example/pixel.png',
    });
    const z = await eigen(A, '3002');
    assert.equal(z.part_name, 'Mit Zählpixel');
    assert.equal(z.image_url ?? null, null);
  });

  await t.test('Figuren: die Eingabe bleibt beim Konto, die geprüfte Quelle füllt den Katalog', async () => {
    await addManualFig(A, { fig_number: 'sw0011', quantity: 1, fig_name: 'Annas Figur' });
    abrufe = [];
    await addManualFig(B, { fig_number: 'sw0011', quantity: 1 });
    assert.deepEqual(abrufe, ['getMinifigInfo sw0011']);
    assert.equal(
      (await db.get('SELECT fig_name FROM minifigs_catalog WHERE fig_number = $1', ['sw0011'])).fig_name,
      'Chewbacca',
    );
    assert.equal(
      (await db.get('SELECT fig_name FROM figur_eigen WHERE user_id = $1 AND fig_number = $2', [A, 'sw0011'])).fig_name,
      'Annas Figur',
    );
  });
});
