/**
 * “Can I build this?" — the comparison between parts list and own stock.
 *
 * Counter-check: in src/parts/queries.ts loose taken from total → red “counts per part AND color, not per part number”.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testData();
const { holdsPart } = require('./helpers/inventory');

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

  // The same part number in TWO colors, and the same color for TWO
  // part numbers: only that way does a slipped pairing show.
  // The column `quelle` is ROUTE: holdsPart() derives it from the set number
  // — a row with a set is a set part, one without a manual one. …
  const parts = [
    // user, number, color, quantity, set
    [U.ich, '3001', 4, 6, '10179-1'],
    [U.ich, '3001', 4, 2, null],
    [U.ich, '3001', 5, 3, null],
    [U.ich, '3002', 4, 10, '10179-1'],
    [U.kind, '3001', 4, 1, null],
    [U.fremd, '3001', 4, 99, null],
  ];
  for (const [uid, num, farbe, quantity, set] of parts) {
    // Since migration 0034 the name belongs in the catalog, not on the
    // Bestandszeile.
    await db.run(
      `INSERT INTO part_catalog (part_number, part_name) VALUES ($1,$2)
       ON CONFLICT (part_number) DO NOTHING`,
      [num, 'Teil ' + num],
    );
    await holdsPart(db, uid, num, { setNumber: set, quantity, colorId: farbe });
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

test('inventory reconciliation against a real database', async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    keineDb(t);
    return;
  }
  await seed();
  const { ownedQuantitiesQuery, MAX_OWNED_PARTS } = _req('src/parts/queries.js');
  const household = {
    ..._req('src/household/rules.js'),
    ..._req('src/household/household.js'),
    ...require('./helpers/sources').testArea('household'),
  };

  await t.test('counts per part AND color, not per part number', async () => {
    const b = await ownedQuantitiesQuery(
      [U.ich],
      [
        { part_number: '3001', color_id: 4 },
        { part_number: '3001', color_id: 5 },
        { part_number: '3002', color_id: 4 },
      ],
    );
    // 6 from the set + 2 loose = 8 total, of which 2 loose.
    assert.deepEqual(b['3001|4'], { total: 8, loose: 2 });
    // The same number, another color — must not mix.
    assert.deepEqual(b['3001|5'], { total: 3, loose: 3 });
    // Another number, the same color — just as little.
    assert.deepEqual(b['3002|4'], { total: 10, loose: 0 });
  });

  await t.test('"lose" excludes what is in a set', async () => {
    // The actual point of the second number: a part in a built
    // set one owns, but one would have to take apart another set for it.
    const b = await ownedQuantitiesQuery([U.ich], [{ part_number: '3002', color_id: 4 }]);
    assert.equal(b['3002|4'].total, 10);
    assert.equal(b['3002|4'].loose, 0, 'Ein Set-Teil darf nicht als lose gelten');
  });

  await t.test('what is not there is missing in the response', async () => {
    // Deliberately no entry with 0 instead of a missing one: the UI sets
    // missing keys to 0 and thus does not distinguish — the server
    // saves a row per part not present for that, and for
    // a big set those are most.
    const b = await ownedQuantitiesQuery([U.ich], [{ part_number: '9999', color_id: 0 }]);
    assert.equal(b['9999|0'], undefined);
  });

  await t.test('the scope decides, not the request', async () => {
    // Without this limit the comparison would be a way of counting foreign stocks.
    const nurIch = await ownedQuantitiesQuery([U.ich], [{ part_number: '3001', color_id: 4 }]);
    const withKind = await ownedQuantitiesQuery(await household.scopeIds(U.ich, 'all'), [
      { part_number: '3001', color_id: 4 },
    ]);
    assert.equal(nurIch['3001|4'].total, 8);
    assert.equal(withKind['3001|4'].total, 9, 'Das Unterkonto muss mitzählen');
    // 99 pieces lie with 'fremd' — they must not appear anywhere.
    assert.ok(withKind['3001|4'].total < 99, 'Ein fremder Bestand ist durchgeschlagen');
  });

  await t.test('duplicate requests and empty inputs do not run into nothing', async () => {
    const b = await ownedQuantitiesQuery(
      [U.ich],
      [
        { part_number: '3001', color_id: 4 },
        { part_number: '3001', color_id: 4 }, // twice
        { part_number: '', color_id: 4 }, // leer
        { part_number: '3001' }, // without color → 0
      ],
    );
    assert.equal(b['3001|4'].total, 8, 'Eine doppelte Anfrage darf nicht doppelt zählen');
    assert.deepEqual(await ownedQuantitiesQuery([U.ich], []), {});
  });

  await t.test('the request is capped', async () => {
    // A parts list over many sets must not build an unbounded query.
    // MEASURED: the cap applies, the response stays empty instead of throwing.
    assert.equal(typeof MAX_OWNED_PARTS, 'number');
    const viele = Array.from({ length: MAX_OWNED_PARTS + 50 }, (_, i) => ({ part_number: 'x' + i, color_id: 0 }));
    viele.push({ part_number: '3001', color_id: 4 }); // stands BEHIND the cap
    const b = await ownedQuantitiesQuery([U.ich], viele);
    assert.deepEqual(b, {}, 'Alles hinter dem Deckel muss wegfallen — auch Vorhandenes');
  });

  await db.pool.end().catch(() => {});
});
