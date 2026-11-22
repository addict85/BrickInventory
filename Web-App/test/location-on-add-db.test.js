/**
 * The storage location can be set when CAPTURING — not only afterwards.
 *
 * ── Counter-checks (carried out, result in the commit) ──────────────────────────
 *   a) the storage location call removed in setErfassen()  → step 1 red.
 *   b) likewise in addManualPart()                         → step 3 red.
 *   c) likewise in addManualMinifig()                      → step 4 red.
 *   d) `storage` not passed through in uebernimm()         → step 5 red.
 *   e) minifigs not counted in lagerorte()                 → step 6 red.
 *   f) minifigs not counted in loescheOrt()                → step 7 red.
 *
 * Prerequisite: test DB (contents are cleared!) via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');

/**
 * The storage location NAME of a stock row.
 *
 * Since migration 0031 the row carries an ID; the name stands in the stock. The
 * checks below still ask for the name — that is the statement that
 * matters — only the path there now leads through a JOIN.
 */
async function locationOf(db, tabelle, bedingung, params) {
  const r = await db.get(
    `SELECT l.name AS storage
       FROM ${tabelle} t
       LEFT JOIN storage_locations l ON l.id = t.storage_id
      WHERE ${bedingung}`,
    params,
  );
  return r?.storage ?? null;
}
const db = testData();

const U = {};

async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const client = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(client);
  } finally {
    client.release();
  }
  await db.run(`INSERT INTO users (username, password_hash) VALUES ('ich','x')`);
  U.ich = (await db.get(`SELECT id FROM users WHERE username='ich'`)).id;
}

async function dbReachable() {
  try {
    await db.get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

/** Does the place stand in the STOCK? That is the half a mere UPDATE does not do. */
async function inStock(uid, name) {
  const r = await db.get('SELECT 1 AS da FROM storage_locations WHERE user_id=$1 AND lower(name)=lower($2)', [
    uid,
    name,
  ]);
  return !!r;
}

test('storage location when capturing — against a real database', async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    noDb(t);
    return;
  }
  await seed();
  const setService = require('./helpers/sources').areaPage('sets');
  const parts = _req('src/parts/manualParts.js');
  const minifigs = _req('src/minifigs/manualMinifigs.js');
  const merkliste = _req('src/wanted/wanted.js');
  const L = {
    ..._req('src/inventory/storageLocation.js'),
    ...require('./helpers/sources').testArea('inventory').locationService,
  };

  await t.test('1. a set comes into the gallery with its storage location', async () => {
    // Like the CSV import (top up); the job fetches the catalog, the storage location is checked.
    await setService.acquireSet({
      requester: U.ich,
      setNumber: '10179-1',
      quantity: 1,
      condition: 'N',
      lagerort: 'Kiste 3',
      ifPresent: 'aufstocken',
    });
    const location = await locationOf(db, 'sets', 't.user_id=$1 AND t.set_number=$2', [U.ich, '10179-1']);
    assert.equal(location, 'Kiste 3', 'The set was recorded, but without the given storage location.');
  });

  await t.test('2. the newly typed place lands in the stock', async () => {
    // Otherwise it would stand on the set but be missing in the selection list it
    // is supposed to be chosen from — Marco's „man kann auch gleich neue Auswahlwerte
    // erfassen".
    assert.ok(await inStock(U.ich, 'Kiste 3'), 'The location is at the set, but not in the stock.');
  });

  await t.test('3. a manually captured part gets its storage location', async () => {
    await parts.addManualPart(U.ich, { part_number: '3001', color_id: 4, quantity: 2, storage: 'Regal B' });
    const r = await db.get(
      `SELECT l.name AS storage FROM parts t
         LEFT JOIN storage_locations l ON l.id = t.storage_id
        WHERE t.user_id=$1 AND t.part_number=$2 AND t.source='manual'`,
      [U.ich, '3001'],
    );
    assert.equal(r?.storage, 'Regal B');
    assert.ok(await inStock(U.ich, 'Regal B'), 'Not in the stock');
  });

  await t.test('4. a manually captured minifigure gets its storage location', async () => {
    // Until migration 0024 the column did not exist at all.
    await minifigs.addManualMinifig(U.ich, { fig_number: 'sw0001', quantity: 1, storage: 'Vitrine' });
    const r = await db.get(
      `SELECT l.name AS storage FROM minifigs t
         LEFT JOIN storage_locations l ON l.id = t.storage_id
        WHERE t.user_id=$1 AND t.fig_number=$2`,
      [U.ich, 'sw0001'],
    );
    assert.equal(r?.storage, 'Vitrine');
    assert.ok(await inStock(U.ich, 'Vitrine'), 'Not in the stock');
  });

  await t.test('5. the adoption from the wishlist passes it through', async () => {
    await db.run(`INSERT INTO wanted (user_id, set_number, condition) VALUES ($1,$2,'N')`, [U.ich, '75192-1']);
    await merkliste.fulfillWantedItem(U.ich, U.ich, '75192-1', 'N', { quantity: 1, storage: 'Dachboden' });
    const location = await locationOf(db, 'sets', 't.user_id=$1 AND t.set_number=$2', [U.ich, '75192-1']);
    assert.equal(location, 'Dachboden', 'The watch item was taken over, the storage location got lost on the way.');
  });

  await t.test('6. the overview counts figures SEPARATELY, not as part kinds', async () => {
    // „18 Teilesorten" would otherwise mean 18 part kinds at one time and 12 plus 6
    // figures at another, and nobody could tell from the number what is meant.
    const liste = await L.lagerorte([U.ich]);
    const vitrine = liste.find(o => o.location === 'Vitrine');
    assert.ok(vitrine, 'A location in which ONLY a minifig lies is missing in the overview.');
    assert.deepEqual([vitrine.sets, vitrine.parts, vitrine.minifigs], [0, 0, 1]);
    const kiste = liste.find(o => o.location === 'Kiste 3');
    assert.deepEqual([kiste.sets, kiste.parts, kiste.minifigs], [1, 0, 0]);
  });

  await t.test('7. a place with only one figure in it cannot be deleted', async () => {
    // Otherwise the assignment of the figure would afterwards point to a name that the
    // stock no longer knows.
    const location = await db.get('SELECT id FROM storage_locations WHERE user_id=$1 AND name=$2', [U.ich, 'Vitrine']);
    // What is checked is `code`, not the text: fachfehler() puts the German
    // version into `message` and the code next to it (src/infra/errorTexts.ts). Checking
    // the text would mean hanging the rule on a translation.
    await assert.rejects(
      () => L.deleteStorage(U.ich, parseInt(location.id, 10)),
      (/** @type {any} */ e) => e?.code === 'storage_in_use',
      'The location could be deleted although a minifig lies in it.',
    );
  });

  await t.test('8. renaming takes the figures along', async () => {
    const location = await db.get('SELECT id FROM storage_locations WHERE user_id=$1 AND name=$2', [U.ich, 'Vitrine']);
    await L.renameStorage(U.ich, parseInt(location.id, 10), 'Vitrine Wohnzimmer');
    const minifigLocation = await locationOf(db, 'minifigs', 't.user_id=$1 AND t.fig_number=$2', [U.ich, 'sw0001']);
    assert.equal(minifigLocation, 'Vitrine Wohnzimmer', 'The stock was renamed, the minifig points to the old name.');
  });

  await db.pool.end().catch(() => {});
});
