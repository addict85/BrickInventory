/**
 * Storage location against a real database.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const { holdsSet, holdsPart } = require('./helpers/inventory');
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

  for (const name of ['ich', 'kind', 'fremd']) {
    await db.run(`INSERT INTO users (username, password_hash) VALUES ($1,'x')`, [name]);
    U[name] = (await db.get('SELECT id FROM users WHERE username=$1', [name])).id;
  }
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2)', [U.ich, U.kind]);

  // The same part in TWO sets — the most important statement hangs on this.
  for (const [uid, sn] of [
    [U.ich, '10179-1'],
    [U.ich, '75192-1'],
    [U.kind, '21318-1'],
    [U.fremd, '10030-1'],
  ]) {
    await holdsSet(db, uid, sn, 1);
  }
  for (const [uid, sn, num, farbe] of [
    [U.ich, '10179-1', '3001', 4],
    [U.ich, '75192-1', '3001', 4],
    // THE SAME part in another color. Without this line the
    // counter-check „Farbbedingung wirkungslos" stayed green: in the seed 3001 existed
    // only in one color, so no color error could hit anything.
    [U.ich, '10179-1', '3001', 5],
    [U.ich, '10179-1', '3002', 4],
    [U.fremd, '10030-1', '3001', 4],
  ]) {
    // The name stands in the catalog since migration 0034.
    await db.run(
      `INSERT INTO part_catalog (part_number, part_name) VALUES ($1,$2)
       ON CONFLICT (part_number) DO NOTHING`,
      [num, 'Teil ' + num],
    );
    await holdsPart(db, uid, num, { setNumber: sn, quantity: 1, colorId: farbe });
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

test('storage location against a real database', async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    noDb(t);
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
  const writable = await household.writeScope(U.ich);

  await t.test('a part lies at ONE place, not at one per set', async () => {
    // The same part is in two sets and thus in two rows. If setting
    // hit only one of them, one would have to maintain the same place per set — and
    // the overview showed the part in two boxes, one of which is empty.
    const n = await L.setLocation('part', writable, ['3001', '4'], 'Kiste 3');
    assert.equal(n, 2, `${n} rows hit, expected 2 (both sets)`);
    const rows = await db.all(
      `SELECT t.color_id, l.name AS storage
         FROM parts t LEFT JOIN storage_locations l ON l.id = t.storage_id
        WHERE t.user_id=$1 AND t.part_number=$2 ORDER BY t.color_id`,
      [U.ich, '3001'],
    );
    assert.deepEqual(
      rows.map(r => [parseInt(r.color_id, 10), r.storage]),
      [
        [4, 'Kiste 3'],
        [4, 'Kiste 3'],
        [5, null],
      ],
      'Both rows of color 4 must have the location — and color 5 none',
    );
  });

  await t.test('setting stays in the write scope', async () => {
    // Without this boundary the storage location would be a way to write into foreign
    // data — and inconspicuously at that, because nothing else changes.
    const vorher =
      (
        await db.get(
          `SELECT l.name AS storage FROM parts t
         LEFT JOIN storage_locations l ON l.id = t.storage_id
        WHERE t.user_id=$1`,
          [U.fremd],
        )
      )?.storage ?? null;
    await L.setLocation('part', writable, ['3001', '4'], 'Kiste 9');
    const nachher =
      (
        await db.get(
          `SELECT l.name AS storage FROM parts t
         LEFT JOIN storage_locations l ON l.id = t.storage_id
        WHERE t.user_id=$1`,
          [U.fremd],
        )
      )?.storage ?? null;
    assert.equal(nachher, vorher, 'A foreign row was changed');

    // Reset: the overview further down counts the same rows. Without
    // that it said „Kiste 9" instead of „Kiste 3" — the first draft of this
    // file stumbled over exactly that, and only two checks
    // later. A test that changes its setup is a setup for all
    // following ones.
    await L.setLocation('part', writable, ['3001', '4'], 'Kiste 3');
  });

  await t.test('empty means NULL, not a place called "nothing"', async () => {
    // An empty text would stand as its own entry in every selection list.
    for (const eingabe of ['', '   ', null, undefined]) {
      assert.equal(L.normalizeLocation(eingabe), null, `„${eingabe}“ did not become null`);
    }
    assert.equal(L.normalizeLocation('  Kiste 3  '), 'Kiste 3', 'Not trimmed');

    await L.setLocation('part', writable, ['3002', '4'], 'Regal B');
    await L.setLocation('part', writable, ['3002', '4'], null);
    const r = await db.get(
      `SELECT l.name AS storage FROM parts t
         LEFT JOIN storage_locations l ON l.id = t.storage_id
        WHERE t.user_id=$1 AND t.part_number=$2`,
      [U.ich, '3002'],
    );
    assert.equal(r.storage, null, 'Clearing did not remove the location');
  });

  await t.test('names that are too long are rejected, not truncated', async () => {
    // Truncating would mean: the database holds something other than what was entered,
    // and nobody learns of it.
    assert.throws(() => L.normalizeLocation('x'.repeat(L.LOCATION_MAX_CHARS + 1)), /storage_too_long|zu lang/i);
    assert.equal(
      L.normalizeLocation('x'.repeat(L.LOCATION_MAX_CHARS)).length,
      L.LOCATION_MAX_CHARS,
      'The limit itself must still go through',
    );
  });

  await t.test('the overview merges sets and parts into ONE list', async () => {
    await L.setLocation('set', writable, ['10179-1'], 'Kiste 3');
    await L.setLocation('set', writable, ['75192-1'], 'Regal B');

    const locations = await L.lagerorte(await household.scopeIds(U.ich, 'all'));
    const karte = Object.fromEntries(locations.map(o => [o.location, o]));
    // „Kiste 3" has a set AND two part rows — one place, not two
    // entries. Delivering two separate lists would mean that every UI
    // merges them itself, and each one on its own.
    // `figuren`: a minifigure carries a storage location too (migration 0024).
    assert.deepEqual(karte['Kiste 3'], { location: 'Kiste 3', sets: 1, parts: 2, minifigs: 0 });
    assert.deepEqual(karte['Regal B'], { location: 'Regal B', sets: 1, parts: 0, minifigs: 0 });
    // Alphabetical — the selection list should not differ on every call.
    assert.deepEqual(
      locations.map(o => o.location),
      [...locations.map(o => o.location)].sort(),
    );
    // And nothing foreign.
    assert.ok(!locations.some(o => o.location === 'Kiste 9'), 'A foreign location appeared');
  });

  await t.test('the overview follows the scope', async () => {
    await L.setLocation('set', await household.writeScope(U.kind), ['21318-1'], 'Kinderzimmer');
    const oben = (await L.lagerorte(await household.scopeIds(U.ich, 'all'))).map(o => o.location);
    const unten = (await L.lagerorte(await household.scopeIds(U.kind, 'all'))).map(o => o.location);
    assert.ok(oben.includes('Kinderzimmer'), 'The main account does not see the location of the child');
    assert.ok(
      !unten.includes('Kiste 3'),
      'The sub-account sees a location of the main account — the view only goes downwards',
    );
  });

  await db.pool.end().catch(() => {});
});
