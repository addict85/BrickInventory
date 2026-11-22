/**
 * The storage location DEFAULT against a real database.
 *
 * Counter-check: defaultOf() (src/inventory/storageLocation.ts) returns null when the row exists → red “without a star there is no default”.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
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

  for (const name of ['ich', 'kind']) {
    await db.run(`INSERT INTO users (username, password_hash) VALUES ($1,'x')`, [name]);
    U[name] = (await db.get('SELECT id FROM users WHERE username=$1', [name])).id;
  }
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2)', [U.ich, U.kind]);
  await holdsSet(db, U.ich, '10179-1', 1);
}

async function dbReachable() {
  try {
    await db.get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

test('storage location default against a real database', async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    noDb(t);
    return;
  }
  await seed();
  const holding = require('./helpers/sources').testArea('inventory');
  const L = { ..._req('src/inventory/storageLocation.js'), ...holding.locationService, setDefault: holding.setDefault };

  const estrich = (await L.createStorage(U.ich, 'Estrich')).location;
  const cellar = (await L.createStorage(U.ich, 'Keller')).location;
  const fremd = (await L.createStorage(U.kind, 'Kinderzimmer')).location;

  await t.test('without a star there is no default', async () => {
    // The initial state, and it is a statement of its own: a UI
    // that got a place here would preselect something on the first capture
    // that nobody set.
    assert.equal(await L.defaultOf(U.ich), null);
  });

  await t.test('the star sets the default and it reads back', async () => {
    const gesetzt = await L.setDefault(U.ich, estrich.id);
    assert.equal(gesetzt.name, 'Estrich');
    const parsed = await L.defaultOf(U.ich);
    assert.equal(parsed?.id, estrich.id);
    assert.equal(parsed?.name, 'Estrich');
  });

  await t.test('a second star replaces the first', async () => {
    // A default with exactly one value: two at the same time would be a
    // question without an answer when capturing. That this holds without any effort is the
    // gain from storing it in user_settings (one key, one value).
    await L.setDefault(U.ich, cellar.id);
    assert.equal((await L.defaultOf(U.ich))?.name, 'Keller');
    const n = (
      await db.get(`SELECT COUNT(*)::int c FROM user_settings WHERE user_id=$1 AND key=$2`, [U.ich, L.DEFAULT_KEY])
    ).c;
    assert.equal(n, 1, `${n} Zeilen fuer die Vorgabe — es darf genau eine geben`);
    await L.setDefault(U.ich, estrich.id);
  });

  await t.test('a foreign place is rejected', async () => {
    // The child's nursery is not my shelf (migration 0020). Without
    // this boundary my star would stand at a place in another flat.
    // What is checked is `e.code` and not the text: the first draft searched for
    // „storage_unknown" in the MESSAGE, and that one is in German …
    await assert.rejects(
      () => L.setDefault(U.ich, fremd.id),
      (/** @type {any} */ e) => String(e.code) === 'storage_unknown',
      'Ein fremder Ort liess sich als eigene Vorgabe setzen',
    );
    assert.equal(
      (await L.defaultOf(U.ich))?.name,
      'Estrich',
      'Die abgelehnte Zuweisung hat die bestehende Vorgabe veraendert',
    );
  });

  await t.test('RENAME: the default stays and has a new name', async () => {
    // The statement this file exists for. There is NO line in
    // benenneOrtUm that updates the default — it does not need one, because
    // the ID is stored. With the name this would be red.
    await L.renameStorage(U.ich, estrich.id, 'Dachboden');
    const v = await L.defaultOf(U.ich);
    assert.equal(v?.id, estrich.id, 'Die Vorgabe zeigt nach dem Umbenennen ins Leere');
    assert.equal(
      v?.name,
      'Dachboden',
      'Die Vorgabe traegt noch den alten Namen — dann steht beim Erfassen ein ' +
        'Ort, den die Auswahlliste nicht mehr kennt',
    );
    await L.renameStorage(U.ich, estrich.id, 'Estrich');
  });

  await t.test('DELETE: the default is gone, not broken', async () => {
    // The second statement. A place can only be deleted when nothing lies
    // in it (loescheOrt) — hence an own, empty place for this probe.
    const kiste = (await L.createStorage(U.ich, 'Kiste 7')).location;
    await L.setDefault(U.ich, kiste.id);
    assert.equal((await L.defaultOf(U.ich))?.name, 'Kiste 7');
    await L.deleteStorage(U.ich, kiste.id);
    assert.equal(
      await L.defaultOf(U.ich),
      null,
      'Nach dem Loeschen des Ortes meldet die Vorgabe noch etwas — sie heilt ' +
        'sich also nicht selbst, und die Oberflaeche waehlt einen Ort vor, den ' +
        'es nicht gibt',
    );
    // The orphaned row in user_settings may stay: it is silent (the
    // JOIN finds nothing) and is overwritten with the next star. Cleaning
    // it up would be exactly the code that this design saves.
    const rest = (await db.get(`SELECT value FROM user_settings WHERE user_id=$1 AND key=$2`, [U.ich, L.DEFAULT_KEY]))
      ?.value;
    assert.equal(
      rest,
      String(kiste.id),
      'Erwartet war die stumme, verwaiste Zeile — steht dort etwas anderes, ' +
        'stimmt die Begruendung in src/inventory/storageLocation.ts nicht mehr',
    );
  });

  await t.test('the star can be switched off again', async () => {
    await L.setDefault(U.ich, cellar.id);
    assert.equal((await L.defaultOf(U.ich))?.name, 'Keller');
    assert.equal(await L.setDefault(U.ich, null), null);
    assert.equal(await L.defaultOf(U.ich), null, 'Der Stern liess sich nicht loeschen');
    const n = (
      await db.get(`SELECT COUNT(*)::int c FROM user_settings WHERE user_id=$1 AND key=$2`, [U.ich, L.DEFAULT_KEY])
    ).c;
    assert.equal(n, 0, 'Die Einstellung steht noch da');
  });

  await db.pool.end().catch(() => {});
});
