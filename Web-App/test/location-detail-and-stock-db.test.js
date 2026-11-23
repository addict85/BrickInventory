/**
 * The storage location must stand in the DETAIL — and only in the accounts that have it.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();
// Since migration 0036 a stock entry is TWO rows: one in `sets` („this
// account holds this set") and one per purchase in `set_acquisitions`. holdsSet()
// creates both — see test/helpers/inventory.js.
const { holdsSet, holdsPart, catalogSet } = require('./helpers/inventory');
const { testServer } = require('./helpers/server');

test.after(async () => {
  await db.pool.end().catch(() => {});
});

const SN = '10179-1';
let MAIN = 0,
  KIND = 0;

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
  await db.run(`INSERT INTO users (username, password_hash) VALUES ('haupt','x'),('kind','x')`);
  MAIN = (await db.get("SELECT id FROM users WHERE username='haupt'")).id;
  KIND = (await db.get("SELECT id FROM users WHERE username='kind'")).id;
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2)', [MAIN, KIND]);
  // The set name stands in the catalog, the piece count in the capture, not on the stock row.
  await catalogSet(db, SN, { name: 'Falcon' });
  // The set belongs to the MAIN ACCOUNT. The sub-account has no row at all — exactly
  // the situation in which an entry in its stock describes nothing.
  await holdsSet(db, MAIN, SN, 1);
}

test('storage location: detail and stock against a real database', async t => {
  try {
    await db.get('SELECT 1 AS ok');
  } catch (e) {
    noDb(t, e);
    return;
  }
  await seed();

  const L = {
    ..._req('src/inventory/storageLocation.js'),
    ...require('./helpers/sources').testArea('inventory').locationService,
  };
  const S = require('./helpers/sources').areaPage('sets');
  const household = {
    ..._req('src/household/rules.js'),
    ..._req('src/household/household.js'),
    ...require('./helpers/sources').testArea('household'),
  };
  const writable = await household.writeScope(MAIN);
  // Precondition: the scope really covers BOTH accounts, otherwise
  // finding 2 below checks nothing.
  assert.ok(
    writable.includes(MAIN) && writable.includes(KIND),
    `„schreibbereich“ delivered ${writable} — the household is not set up`,
  );

  assert.equal(
    await L.setLocation('set', writable, [SN], 'Estrich'),
    1,
    'Setting must hit exactly the one row of the main account',
  );

  await t.test('finding 1: the detail call delivers the name of the storage location', async () => {
    const detail = await S.readSet(writable, SN);
    assert.equal(
      detail.storage,
      'Estrich',
      `The detail delivers storage=${JSON.stringify(detail.storage)} — the UI then shows ` +
        'an empty field although the location is in the database',
    );

    // List and detail must say the same. Exactly between these two
    // the QUANTITY already drifted apart (see readSet in src/sets/read.ts).
    const list = await S.readSets(writable, { page: 1, page_size: 10 });
    const row = (list.sets || []).find(s => s.set_number === SN);
    assert.ok(row, 'The set is missing in the list');
    assert.equal(
      row.storage,
      detail.storage,
      `List says ${JSON.stringify(row.storage)}, detail says ` +
        `${JSON.stringify(detail.storage)} — two answers to the same question`,
    );

    // ── COUNTER-CHECK: the query in its earlier form ────────────────────
    // `SELECT s.*` without a resolved name. It delivers storage_id and no
    // storage — exactly the reported picture.
    const alt = await db.get(`SELECT s.* FROM sets s WHERE s.user_id = ANY($1) AND s.set_number = $2 LIMIT 1`, [
      writable,
      SN,
    ]);
    assert.equal(
      alt.storage,
      undefined,
      'The former form suddenly delivers a storage field — then this ' +
        'counter-check no longer checks what it should',
    );
    assert.ok(
      alt.storage_id > 0,
      'The former form delivers no storage_id — then the situation is not the intended one',
    );
  });

  await t.test('finding 2: the place only arises in the account whose row it describes', async () => {
    const main = (await L.locationsOf([MAIN])).map(o => o.name);
    const kind = (await L.locationsOf([KIND])).map(o => o.name);
    assert.deepEqual(main, ['Estrich'], `Stock of the main account: ${main}`);
    assert.deepEqual(
      kind,
      [],
      `The stock of the sub-account contains ${kind} — these entries are in the ` +
        'account filter and show not a single set',
    );

    // ── COUNTER-CHECK: the earlier INSERT ─────────────────────────────────────
    // It created the place for every writable account. Executed here,
    // the phantom entry must arise in the sub-account — and afterwards be gone again.
    await db.run(
      `INSERT INTO storage_locations (user_id, name)
       SELECT id, $2 FROM users WHERE id = ANY($1)
       ON CONFLICT (user_id, lower(name)) DO NOTHING`,
      [writable, 'Estrich'],
    );
    const kindNachAlt = (await L.locationsOf([KIND])).map(o => o.name);
    assert.deepEqual(
      kindNachAlt,
      ['Estrich'],
      'The former form creates NO entry in the sub-account — then this ' +
        'counter-check no longer checks what it should',
    );
    const occupied = await db.get(`SELECT COUNT(*)::int AS n FROM sets WHERE user_id = $1 AND storage_id IS NOT NULL`, [
      KIND,
    ]);
    assert.equal(
      occupied.n,
      0,
      'The sub-account suddenly holds a set with a storage location — the situation is not the intended one',
    );
    await db.run('DELETE FROM storage_locations WHERE user_id = $1', [KIND]);
  });

  await t.test('a place on a foreign set leaves no entry', async () => {
    // This property was had by the earlier path via a transaction with
    // rollback. It must stay, even though the rollback has gone away:
    // now it is asked beforehand who holds a row at all.
    const n = await L.setLocation('set', writable, ['99999-1'], 'Garage');
    assert.equal(n, 0, 'A set nobody holds must not hit any row');
    for (const [who, id] of [
      ['Hauptkonto', MAIN],
      ['Unterkonto', KIND],
    ]) {
      const locations = (await L.locationsOf([id])).map(o => o.name);
      assert.ok(
        !locations.includes('Garage'),
        `The stock of ${who} got „Garage“ although no set was hit: ${locations}`,
      );
    }
  });

  await t.test('the sub-account gets its own entry as soon as it holds a row', async () => {
    // The flip side of finding 2: not „only the main account", but „whoever
    // holds the row". If the sub-account holds a copy, the place belongs there too
    // — and as an OWN row, because a shelf stands in one flat
    // (Migration 0020). …
    await holdsSet(db, KIND, SN, 1);
    const n = await L.setLocation('set', writable, [SN], 'Keller');
    assert.equal(n, 2, `${n} rows hit, expected 2 (both accounts hold the set)`);
    for (const [who, id] of [
      ['Hauptkonto', MAIN],
      ['Unterkonto', KIND],
    ]) {
      const locations = (await L.locationsOf([id])).map(o => o.name);
      assert.ok(locations.includes('Keller'), `The stock of ${who} does not have „Keller“: ${locations}`);
    }
    // And the detail combines both instead of concealing one.
    await L.setLocation('set', [MAIN], [SN], 'Estrich');
    const detail = await S.readSet(writable, SN);
    assert.equal(
      detail.storage,
      'Estrich, Keller',
      `The detail shows ${JSON.stringify(detail.storage)} — with two owners in ` +
        'two boxes it must name both, as the list does',
    );
  });
});

/**
 * The storage location filter of the set list, checked via the ROUTE. Counter-check: `storage` removed from
 * the passing-on in routes/api/sets.ts → red („2 Sets statt 1“); without a filter
 * both sets come (otherwise an empty list would pass too).
 */
test("the lists' storage location filter works via the route", async t => {
  try {
    await db.get('SELECT 1 AS ok');
  } catch (e) {
    noDb(t, e);
    return;
  }
  await seed();

  const L = {
    ..._req('src/inventory/storageLocation.js'),
    ...require('./helpers/sources').testArea('inventory').locationService,
  };
  // A second set WITHOUT a storage location — without it the filter would have nothing
  // to sift out, and „all" would be indistinguishable from „the right ones".
  const WITHOUT = '21058-1';
  await catalogSet(db, WITHOUT, { name: 'Cheops' });
  await holdsSet(db, MAIN, WITHOUT, 1);
  await L.setLocation('set', [MAIN], [SN], 'Estrich');

  // A part in the same box and one without — for the parts list next to it.
  await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES
                  ('3001','Brick 2x4'), ('3002','Brick 2x3')
                ON CONFLICT (part_number) DO NOTHING`);
  await db.run(`INSERT INTO part_color_catalog (part_number, color_id, color_name) VALUES
                  ('3001',4,'Rot'), ('3002',4,'Rot')
                ON CONFLICT (part_number, color_id) DO NOTHING`);
  await holdsPart(db, MAIN, '3001', { setNumber: SN, quantity: 2, colorId: 4 });
  await holdsPart(db, MAIN, '3002', { setNumber: WITHOUT, quantity: 2, colorId: 4 });
  // The keys are a FLAT list in the order of the CONDITION
  // (src/inventory/storageLocation.ts): for a part number AND color, i.e. two entries.
  await L.setLocation('part', [MAIN], ['3001', 4], 'Estrich');

  const { base } = testServer(_req, { session: { userId: MAIN }, t });
  const hole = async path => {
    const r = await fetch(base + path);
    assert.equal(r.status, 200, `${path} antwortete ${r.status}`);
    return r.json();
  };

  await t.test('sets: without a filter both come', async () => {
    const d = await hole('/api/v2/sets?page=1&page_size=60');
    const numbers = (d.sets || []).map(s => s.set_number).sort();
    assert.deepEqual(
      numbers,
      [WITHOUT, SN].sort(),
      `Precondition: both sets must come without a filter, got ${JSON.stringify(numbers)}`,
    );
  });

  await t.test('sets: with storage=Estrich ONLY the set in the box comes', async () => {
    const d = await hole(`/api/v2/sets?page=1&page_size=60&storage=${encodeURIComponent('Estrich')}`);
    const numbers = (d.sets || []).map(s => s.set_number);
    assert.deepEqual(
      numbers,
      [SN],
      `Expected only ${SN}, got ${JSON.stringify(numbers)}. If BOTH come, the ` +
        'route dropped the parameter — the filter in setsLesen() is fine, ' +
        'it just never gets to see it.',
    );
    assert.equal(
      Number(d.total),
      1,
      `total says ${d.total} instead of 1 — then the total counts unfiltered, and ` +
        'the UI pages through sets it does not show',
    );
  });

  await t.test('sets: a place that does not exist delivers nothing', async () => {
    // The opposite direction: without it the case above would be green too if the
    // filter mapped every value to the same one set.
    const d = await hole('/api/v2/sets?page=1&page_size=60&storage=Dachboden');
    assert.deepEqual(
      (d.sets || []).map(s => s.set_number),
      [],
      'An unknown storage location must result in an empty list',
    );
  });

  await t.test('parts: the same filter, the same path', async () => {
    const all = await hole('/api/v2/parts?page=1&page_size=60');
    const numbersAll = (all.parts || []).map(p => p.part_number).sort();
    assert.deepEqual(
      numbersAll,
      ['3001', '3002'],
      `Precondition: both parts without a filter, got ${JSON.stringify(numbersAll)}`,
    );

    const d = await hole(`/api/v2/parts?page=1&page_size=60&storage=${encodeURIComponent('Estrich')}`);
    assert.deepEqual(
      (d.parts || []).map(p => p.part_number),
      ['3001'],
      `Expected only 3001, got ${JSON.stringify((d.parts || []).map(p => p.part_number))}`,
    );
  });
});
