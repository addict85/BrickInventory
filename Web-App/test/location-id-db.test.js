/**
 * The storage location on the stock is an ID — and what that saves.
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

let UID = 0;

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
  UID = (await db.get("SELECT id FROM users WHERE username='ich'")).id;
  await holdsSet(db, UID, '10179-1', 1);
}

/** The NAME the UI sees on the set — resolved via the stock. */
async function ortAmSet(sn) {
  return (
    (
      await db.get(
        `SELECT l.name FROM sets t LEFT JOIN storage_locations l ON l.id = t.storage_id
      WHERE t.user_id = $1 AND t.set_number = $2`,
        [UID, sn],
      )
    )?.name ?? null
  );
}

async function dbReachable() {
  try {
    await db.get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

test('storage location as an ID against a real database', async t => {
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
  const household = {
    ..._req('src/household/rules.js'),
    ..._req('src/household/household.js'),
    ...require('./helpers/sources').testArea('household'),
  };
  const writable = await household.schreibbereich(UID);

  const estrich = (await L.putLocationAn(UID, 'Estrich')).ort;

  await t.test('a different spelling lands in the EXISTING place', async () => {
    // The core. „estrich" is typed, the stock holds „Estrich" — and the
    // set then shows the spelling of the stock. With the name on the stock entry
    // „estrich" stood here, and with that the assignment was from then on a different
    // string than the entry it was chosen from.
    const n = await L.setLocation('set', writable, ['10179-1'], 'estrich');
    assert.equal(n, 1, `${n} Zeilen getroffen, erwartet 1`);
    assert.equal(
      await ortAmSet('10179-1'),
      'Estrich',
      'Das Set trägt eine eigene Schreibweise — dann ist es nicht derselbe Ort',
    );
    const orte = (await L.locationsOf([UID])).map(o => o.name);
    assert.deepEqual(
      orte,
      ['Estrich'],
      `Der Vorrat hat ${orte.length} Einträge: ${orte} — „estrich" hat einen zweiten angelegt`,
    );
    const id = (await db.get('SELECT storage_id FROM sets WHERE user_id=$1 AND set_number=$2', [UID, '10179-1']))
      .storage_id;
    assert.equal(parseInt(String(id), 10), estrich.id, 'Die Zeile zeigt nicht auf den Eintrag im Vorrat');
  });

  await t.test('renaming works without a single line of follow-up work', async () => {
    // benenneOrtUm() rewrites ONLY the stock. With the name this needed
    // a loop over three tables in one transaction — and that
    // compared character by character, so it did not hit „estrich".
    await L.benenneOrtUm(UID, estrich.id, 'Dachboden');
    assert.equal(
      await ortAmSet('10179-1'),
      'Dachboden',
      'Das Set steht im alten Ort — das Umbenennen war ein Verlieren',
    );
  });

  await t.test('an occupied place cannot be deleted', async () => {
    // The occupied check counts via the ID. With the name it counted zero for
    // a different spelling and released the place — the set then kept
    // a name that the selection list no longer knew.
    await assert.rejects(
      () => L.loescheOrt(UID, estrich.id),
      (/** @type {any} */ e) => String(e.code) === 'lagerort_in_benutzung',
      'Ein belegter Ort liess sich loeschen',
    );
    assert.deepEqual(
      (await L.locationsOf([UID])).map(o => o.name),
      ['Dachboden'],
      'Die Auswahlliste ist leer, das Set zeigt aber weiter auf einen Ort',
    );
  });

  await t.test('clearing sets the ID to NULL', async () => {
    // Empty and NULL are the same: „not captured" (reasoning in 0018).
    await L.setLocation('set', writable, ['10179-1'], null);
    assert.equal(await ortAmSet('10179-1'), null, 'Das Leeren hat nichts entfernt');
    // And now deleting works, because nothing lies in it any more.
    await L.loescheOrt(UID, estrich.id);
    assert.deepEqual(await L.locationsOf([UID]), []);
  });

  await t.test('a failed attempt creates no place in the stock', async () => {
    // The old path had this property on the side: it assigned first and
    // created the place only on success. With the ID it must run the other way round
    // (no row, no ID), hence both stand in one transaction with
    // rollback. Without it a place would stand in the list after every typo.
    const vorher = (await L.locationsOf([UID])).length;
    const n = await L.setLocation('set', writable, ['99999-1'], 'Geisterkiste');
    assert.equal(n, 0, 'Ein Set, das es nicht gibt, wurde angeblich geaendert');
    assert.equal(
      (await L.locationsOf([UID])).length,
      vorher,
      'Der Fehlversuch hat „Geisterkiste" im Vorrat hinterlassen',
    );
  });

  await db.pool.end().catch(() => {});
});
