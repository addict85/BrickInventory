/**
 * The STOCK of storage locations — against a real database.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const { holdsSet } = require('./helpers/inventory');
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
  for (const name of ['grandparent', 'enkel']) {
    await db.run(`INSERT INTO users (username, password_hash) VALUES ($1,'x')`, [name]);
    U[name] = (await db.get('SELECT id FROM users WHERE username=$1', [name])).id;
  }
}

async function dbReachable() {
  try {
    await db.get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

test('storage location stock against a real database', { concurrency: 1 }, async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    keineDb(t);
    return;
  }
  await seed();
  const L = {
    ..._req('src/inventory/storageLocation.js'),
    ...require('./helpers/sources').testArea('inventory').locationService,
  };

  await t.test('create, and creating the same twice is no second entry', async () => {
    const a = await L.createStorage(U.grandparent, 'Regal A');
    assert.equal(a.was_new, true);
    assert.equal(a.location.name, 'Regal A');

    // Upper/lower case does NOT decide: „Regal A" and „regal a" are
    // the same shelf. Two entries for it would be a trap in the
    // selection list, not a choice.
    const b = await L.createStorage(U.grandparent, 'regal a');
    assert.equal(b.was_new, false, '„regal a" wurde als zweiter Ort angelegt');
    assert.equal(b.location.id, a.location.id);
    // And the original name stays — the first spelling wins.
    assert.equal(b.location.name, 'Regal A');
  });

  await t.test('empty and too long are rejected, not bent into shape', async () => {
    for (const roh of ['', '   ', null, undefined]) {
      await assert.rejects(
        () => L.createStorage(U.grandparent, roh),
        (/** @type {any} */ e) => String(e.code) === 'storage_empty',
        `${JSON.stringify(roh)} wurde angenommen`,
      );
    }
    await assert.rejects(
      () => L.createStorage(U.grandparent, 'x'.repeat(61)),
      (/** @type {any} */ e) => String(e.code) === 'storage_too_long',
    );
    // Exactly on the limit is allowed — otherwise the number in the
    // error message („höchstens 60") would be a lie.
    const rand = await L.createStorage(U.grandparent, 'y'.repeat(60));
    assert.equal(rand.was_new, true);
    await db.run('DELETE FROM storage_locations WHERE id = $1', [rand.location.id]);
  });

  await t.test('every account has its own stock', async () => {
    // A storage location is a shelf in a flat. The grandfather has other
    // shelves than the grandchild, even if he may see the grandchild's sets.
    await L.createStorage(U.enkel, 'Kinderzimmer');
    assert.deepEqual(
      (await L.locationsOf([U.grandparent])).map(o => o.name),
      ['Regal A'],
    );
    assert.deepEqual(
      (await L.locationsOf([U.enkel])).map(o => o.name),
      ['Kinderzimmer'],
    );
    // And the grandfather can query both lists together — exactly that is what
    // the selection field does for a set that belongs to both.
    assert.deepEqual(
      (await L.locationsOf([U.grandparent, U.enkel])).map(o => o.name),
      ['Kinderzimmer', 'Regal A'],
      'sortiert ohne Rücksicht auf Gross-/Kleinschreibung',
    );
  });

  await t.test('a new place on the SET lands in the stock', async () => {
    // Marco's „man kann auch gleich neue Auswahlwerte erfassen". Without that
    // the place would stand on the set but be missing in the list it is supposed
    // to be chosen from next time.
    await holdsSet(db, U.enkel, '10179-1', 1);
    assert.equal(await L.setLocation('set', [U.enkel], ['10179-1'], 'Unterm Bett'), 1);
    assert.ok(
      (await L.locationsOf([U.enkel])).some(o => o.name === 'Unterm Bett'),
      'Der frisch getippte Ort fehlt im Vorrat',
    );
  });

  await t.test('a place that hits no row leaves no entry', async () => {
    // No write permission, wrong set number: then nothing should remain in the
    // stock either. Otherwise the list would collect names from failed attempts.
    const vorher = (await L.locationsOf([U.grandparent])).length;
    assert.equal(await L.setLocation('set', [U.grandparent], ['99999-1'], 'Geisterkiste'), 0);
    assert.equal(
      (await L.locationsOf([U.grandparent])).length,
      vorher,
      'Ein Fehlversuch hat einen Ort im Vorrat hinterlassen',
    );
  });

  await t.test('renaming takes the assignments along', async () => {
    const location = (await L.locationsOf([U.enkel])).find(o => o.name === 'Unterm Bett');
    await L.renameStorage(U.enkel, location.id, 'Kiste 3');
    // The statement is the same as before, the path there a different one: until
    // migration 0031 benenneOrtUm() wrote the new name into three tables,
    // and exactly that could miss a spelling. Now the row carries
    // an ID, there is nothing to rewrite — the check stays
    // nevertheless, because it checks the RESULT and not the path.
    const amSet = await db.get(
      `SELECT l.name AS storage FROM sets t
         LEFT JOIN storage_locations l ON l.id = t.storage_id
        WHERE t.set_number = $1`,
      ['10179-1'],
    );
    assert.equal(amSet.storage, 'Kiste 3', 'Das Set steht noch im alten Ort — das Umbenennen war ein Verlieren');
    assert.ok((await L.locationsOf([U.enkel])).some(o => o.name === 'Kiste 3'));
  });

  await t.test('renaming to a taken name is rejected', async () => {
    const location = (await L.locationsOf([U.enkel])).find(o => o.name === 'Kiste 3');
    await assert.rejects(
      () => L.renameStorage(U.enkel, location.id, 'kinderzimmer'),
      (/** @type {any} */ e) => String(e.code) === 'storage_duplicate',
      'Zwei Orte mit demselben Namen wären eine Falle in der Auswahlliste',
    );
    // Its own name onto itself is fine, on the other hand — otherwise
    // „Kiste 3" could not be corrected to „KISTE 3".
    await L.renameStorage(U.enkel, location.id, 'KISTE 3');
    assert.ok((await L.locationsOf([U.enkel])).some(o => o.name === 'KISTE 3'));
  });

  await t.test('a foreign account cannot rename anything', async () => {
    const location = (await L.locationsOf([U.enkel])).find(o => o.name === 'KISTE 3');
    await assert.rejects(
      () => L.renameStorage(U.grandparent, location.id, 'Opas Keller'),
      (/** @type {any} */ e) => String(e.code) === 'storage_unknown',
    );
    await assert.rejects(
      () => L.deleteStorage(U.grandparent, location.id),
      (/** @type {any} */ e) => String(e.code) === 'storage_unknown',
    );
  });

  await t.test('deleting only works for an empty place', async () => {
    const belegt = (await L.locationsOf([U.enkel])).find(o => o.name === 'KISTE 3');
    await assert.rejects(
      () => L.deleteStorage(U.enkel, belegt.id),
      (/** @type {any} */ e) => String(e.code) === 'storage_in_use',
      'Ein belegter Ort liess sich löschen — die Zuordnung wäre ohne Weg zurück weg',
    );

    const leer = (await L.locationsOf([U.enkel])).find(o => o.name === 'Kinderzimmer');
    await L.deleteStorage(U.enkel, leer.id);
    assert.ok(!(await L.locationsOf([U.enkel])).some(o => o.name === 'Kinderzimmer'));

    // And after clearing it out the occupied one goes too.
    await db.run('UPDATE sets SET storage_id = NULL WHERE set_number = $1', ['10179-1']);
    await L.deleteStorage(U.enkel, belegt.id);
    assert.deepEqual(await L.locationsOf([U.enkel]), []);
  });

  await t.test('an assignment without a place in the stock is no longer possible', async () => {
    // What stood here before, and why it is gone
    const frei = (await db.get('SELECT COALESCE(MAX(id),0) + 1000 AS frei FROM storage_locations')).frei;
    await assert.rejects(
      () => db.run('UPDATE sets SET storage_id = $1 WHERE set_number = $2', [frei, '10179-1']),
      (/** @type {any} */ e) => /foreign key|verletzt|violates/i.test(String(e?.message || e)),
      'Ein Set liess sich auf einen Ort setzen, den es im Vorrat nicht gibt',
    );
  });

  await db.pool.end().catch(() => {});
});
