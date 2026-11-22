/**
 * What an account types belongs to it (part_custom, part_color_custom,
 * minifig_custom) and never to the shared catalog: another account does not count it
 * as known and asks Rebrickable; the verified value takes precedence.
 * Typed images only come from the hosts the image proxy shows.
 *
 * Counter-checks (measured on 03.11.2026, one change each, reverted afterwards):
 *   A  rememberPart()/rememberPartColor()/rememberMinifig() without the branch for `von`
 *      (input into the shared catalog) → red: all five subtests
 *   B  partFromCatalog() joins part_custom and part_color_custom without
 *      `user_id = $3` → red: “another account still asks Rebrickable”
 *      and “the verified value takes precedence …” (only the name alone stays
 *      green: Anna's image is missing for Bruno and already triggers the fetch)
 *   C  imageInput() returns every URL → red: “a foreign image host …”
 *
 * REQUIRE_DB=1.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, testSources } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();

// Rebrickable provided at the wiring (testSources); `fetches` counts what was asked.
let fetches = [];
testSources(null, {
  lookupPart: async nr => {
    fetches.push(`lookupPart ${nr}`);
    return {
      part_name: 'Brick 2 x 4',
      category_name: 'Bricks',
      image_url: 'https://cdn.rebrickable.com/media/parts/3001.jpg',
    };
  },
  getMinifigInfo: async nr => {
    fetches.push(`getMinifigInfo ${nr}`);
    return { fig_number: nr, fig_name: 'Chewbacca', image_url: 'https://cdn.rebrickable.com/media/sets/fig.jpg' };
  },
});

test.after(async () => {
  await db.pool.end().catch(() => {});
});

test('the shared catalog', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    noDb(t, e);
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

  const { addManualPart } = _req('src/parts/manualParts.js');
  const { addManualMinifig } = _req('src/minifigs/manualMinifigs.js');
  const { catalogPart } = _req('src/catalog/catalogMaintenance.js');
  const common = nr =>
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
       LEFT JOIN part_custom te ON te.user_id = q.u AND te.part_number = q.nr
       LEFT JOIN part_color_custom tfe ON tfe.user_id = q.u AND tfe.part_number = q.nr AND tfe.color_id = 4`,
      [uid, nr],
    );

  await t.test('the input is in the own details, not in the shared catalog', async () => {
    fetches = [];
    await addManualPart(A, {
      part_number: '3001',
      color_id: 4,
      quantity: 1,
      part_name: 'Annas Name',
      image_url: 'https://cdn.rebrickable.com/media/anna.jpg',
    });
    assert.deepEqual(fetches, [], 'mit Namen wird nicht nachgeschlagen');
    assert.deepEqual(
      { ...(await eigen(A, '3001')) },
      { part_name: 'Annas Name', image_url: 'https://cdn.rebrickable.com/media/anna.jpg' },
    );
    assert.deepEqual({ ...(await common('3001')) }, { part_name: null, image_url: null });
  });

  await t.test('another account still asks Rebrickable', async () => {
    fetches = [];
    await addManualPart(B, { part_number: '3001', color_id: 4, quantity: 1 });
    assert.deepEqual(fetches, ['lookupPart 3001'], 'Annas Eingabe zählt für Bruno nicht als bekannt');
    assert.deepEqual(
      { ...(await common('3001')) },
      { part_name: 'Brick 2 x 4', image_url: 'https://cdn.rebrickable.com/media/parts/3001.jpg' },
    );
    assert.equal((await catalogPart('3001', 4, B)).name, 'Brick 2 x 4');
  });

  await t.test('the verified value takes precedence, the own detail is kept', async () => {
    await addManualPart(A, { part_number: '3001', color_id: 4, quantity: 1, part_name: 'Neuer Name' });
    assert.equal((await catalogPart('3001', 4, A)).name, 'Brick 2 x 4');
    assert.equal((await common('3001')).part_name, 'Brick 2 x 4');
    assert.equal((await eigen(A, '3001')).part_name, 'Annas Name');
  });

  await t.test('a foreign image host does not get into the own details', async () => {
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

  await t.test('figures: the input stays with the account, the verified source fills the catalog', async () => {
    await addManualMinifig(A, { fig_number: 'sw0011', quantity: 1, fig_name: 'Annas Figur' });
    fetches = [];
    await addManualMinifig(B, { fig_number: 'sw0011', quantity: 1 });
    assert.deepEqual(fetches, ['getMinifigInfo sw0011']);
    assert.equal(
      (await db.get('SELECT fig_name FROM minifigs_catalog WHERE fig_number = $1', ['sw0011'])).fig_name,
      'Chewbacca',
    );
    assert.equal(
      (await db.get('SELECT fig_name FROM minifig_custom WHERE user_id = $1 AND fig_number = $2', [A, 'sw0011']))
        .fig_name,
      'Annas Figur',
    );
  });
});
