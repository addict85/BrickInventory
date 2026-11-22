/**
 * The wishlist filter — search, condition, sorting and owner.
 *
 * ── Counter-checks (performed, result in the commit) ─────────────────────────
 *   a) `OR rb.name ILIKE` removed from the search    → step 2 red.
 *   b) masking of the input omitted                 → step 3 red.
 *      (On the first attempt IT STAYED GREEN — the data contained nothing that
 *      the unprotected wildcard would additionally have hit. The seed therefore
 *      got a second set; that is a finding about the check,
 *      not a formal error.)
 *   c) condition clause removed                     → step 4 red.
 *   d) NULLS LAST deleted for price_desc            → step 5 red.
 *      (Deleted for name_asc: STAYED GREEN — with ASC, NULLS LAST is the
 *      Postgres default. Measured, not assumed; the step says so.)
 *   e) fromTable() replaced by WANTED_SORTS[x]      → step 7 red.
 *
 * Prerequisite: test DB (content is wiped!) via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
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

  for (const n of ['grandparent', 'enkel']) {
    await db.run(`INSERT INTO users (username, password_hash) VALUES ($1,'x')`, [n]);
    U[n] = (await db.get(`SELECT id FROM users WHERE username=$1`, [n])).id;
  }

  // Three sets in the catalog — two with names, one WITHOUT. The third is no
  // decoration: a wishlist item for a set that rb_sets does not know is the
  // usual case for new sets, and it decides NULLS LAST.
  for (const [num, name, jahr] of [
    ['10179-1', 'Millennium Falcon', 2007],
    ['75192-1', 'UCS Millennium Falcon', 2017],
  ]) {
    await db.run(`INSERT INTO rb_sets (set_num, name, year) VALUES ($1,$2,$3)`, [num, name, jahr]);
  }

  // Two names the masking depends on: one WITH a percent sign and
  // one that only contains "50". Without the second set the step below would be
  // ineffective — the counter-check showed exactly that: masking removed,
  // check stayed green because "%50%%" hit nothing else in the data back then …
  await db.run(`INSERT INTO rb_sets (set_num, name, year) VALUES ('60000-1','Sale 50% Feuerwehr',2013)`);
  await db.run(`INSERT INTO rb_sets (set_num, name, year) VALUES ('60001-1','Feuerwehr 5000er',2014)`);

  const items = [
    [U.grandparent, '10179-1', 'N'],
    [U.grandparent, '10179-1', 'U'],
    [U.grandparent, '60000-1', 'N'],
    [U.grandparent, '60001-1', 'N'],
    [U.grandparent, '99999-1', 'N'], // no catalog entry: name and year NULL
    [U.enkel, '75192-1', 'N'],
  ];
  // created_at staggered descending so that the default sorting has a
  // definite order and does not follow chance.
  let tage = items.length;
  for (const [uid, sn, c] of items) {
    await db.run(
      `INSERT INTO wanted (user_id, set_number, condition, created_at)
       VALUES ($1,$2,$3, NOW() - ($4 || ' days')::interval)`,
      [uid, sn, c, tage--],
    );
  }

  // Prices only for two wishlist items — the rest has none. That is exactly what
  // the price sorting checks: a missing price belongs at the end, not the start.
  for (const [sn, c, p] of [
    ['10179-1', 'N', 500],
    ['60000-1', 'N', 80],
  ]) {
    await db.run(
      `INSERT INTO price_cache (set_number, condition, currency_code, avg_price)
       VALUES ($1,$2,'EUR',$3)`,
      [sn, c, p],
    );
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

const nummern = liste => liste.map(w => `${w.set_number}/${w.condition}`);

test('wishlist: search, condition, sorting, owner', async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    keineDb(t);
    return;
  }
  await seed();
  const M = _req('src/wanted/wanted.js');
  const alle = [U.grandparent, U.enkel];

  await t.test('1. without a filter everything stays as it was', async () => {
    // The starting point: four parameters were added, and a call without
    // them must still return the same list in the same order.
    const liste = await M.wantedItemsOf(alle, undefined, 'EUR');
    assert.equal(liste.length, 6, `${liste.length} statt 6 Merkposten`);
    // Default added_desc: the most recently added first.
    assert.equal(liste[0].set_number, '75192-1');
  });

  await t.test('2. the search hits number AND name', async () => {
    const perNumber = await M.wantedItemsOf(alle, undefined, 'EUR', { search: '75192' });
    assert.deepEqual(nummern(perNumber), ['75192-1/N']);

    // "Falcon" is in no set number — without the name comparison nothing would
    // come back here. The name comes from rb_sets, not from wanted.
    const perName = await M.wantedItemsOf(alle, undefined, 'EUR', { search: 'falcon' });
    assert.deepEqual(nummern(perName).sort(), ['10179-1/N', '10179-1/U', '75192-1/N']);
  });

  await t.test('3. a percent sign searches for a percent sign', async () => {
    // Without masking the '%' would be the LIKE wildcard: the search would then be
    // for "anything containing 50" — and "Feuerwehr 5000er" would come along.
    // That is not broken, but it is not what was asked for; to the person
    // searching it looks as if the filter does not work.
    const liste = await M.wantedItemsOf(alle, undefined, 'EUR', { search: '50%' });
    assert.deepEqual(nummern(liste), ['60000-1/N'], `Die Maskierung greift nicht: ${nummern(liste).join(', ')}`);
    // The counter-check for it: WITHOUT a percent sign the same search finds both.
    const beide = await M.wantedItemsOf(alle, undefined, 'EUR', { search: '50' });
    assert.equal(beide.length, 2, `„50" findet ${beide.length} statt 2 — Seed veraltet?`);
  });

  await t.test('4. the condition filters, an unknown value does not', async () => {
    const gebraucht = await M.wantedItemsOf(alle, undefined, 'EUR', { condition: 'U' });
    assert.deepEqual(nummern(gebraucht), ['10179-1/U']);
    // Lowercase should work the same — the UIs send what is in
    // their select field, and one of them could send 'u'.
    assert.equal((await M.wantedItemsOf(alle, undefined, 'EUR', { condition: 'u' })).length, 1);
    // An unknown value means "both" and not "none": an empty list
    // would look like an empty wishlist.
    assert.equal((await M.wantedItemsOf(alle, undefined, 'EUR', { condition: 'X' })).length, 6);
  });

  await t.test('5. sorting: the missing value is at the end', async () => {
    // 99999-1 has no name (not in the catalog).
    const nachName = await M.wantedItemsOf(alle, undefined, 'EUR', { sort: 'name_asc' });
    assert.equal(
      nachName[nachName.length - 1].set_number,
      '99999-1',
      `Ohne Namen steht nicht hinten: ${nummern(nachName).join(', ')}`,
    );
    assert.equal(nachName[0].name, 'Feuerwehr 5000er');

    const afterPrice = await M.wantedItemsOf(alle, undefined, 'EUR', { sort: 'price_desc' });
    assert.equal(afterPrice[0].market_price, 500);
    assert.equal(afterPrice[1].market_price, 80);
    assert.equal(
      afterPrice[afterPrice.length - 1].market_price,
      null,
      'Ein Merkposten ohne Preis steht nicht am Ende.',
    );

    const afterNumber = await M.wantedItemsOf(alle, undefined, 'EUR', { sort: 'num_asc' });
    assert.equal(afterNumber[0].set_number, '10179-1');
  });

  await t.test('6. the owner is the view, not a separate parameter', async () => {
    // That is exactly how the route does it: `accounts=` goes through scopeIds() and
    // comes in as userIds. A second place that selects accounts would be
    // the duplication src/household/household.ts warns about.
    const onlyGrandchild = await M.wantedItemsOf([U.enkel], undefined, 'EUR');
    assert.deepEqual(nummern(onlyGrandchild), ['75192-1/N']);
    const onlyGrandparent = await M.wantedItemsOf([U.grandparent], undefined, 'EUR');
    assert.equal(onlyGrandparent.length, 5);
  });

  await t.test('7. an invented sorting falls back to the default', async () => {
    // fromTable() checks with hasOwnProperty. With `WANTED_SORTS[x] || fallback`
    // 'constructor' would have been a valid value — and what then ends up in
    // ORDER BY is no longer a sorting but a function as text.
    for (const boese of ['constructor', 'toString', '__proto__', 'gibtsnicht']) {
      const liste = await M.wantedItemsOf(alle, undefined, 'EUR', { sort: boese });
      assert.equal(liste.length, 6, `${boese} hat die Liste verändert`);
      assert.equal(liste[0].set_number, '75192-1', `${boese} hat die Reihenfolge verändert`);
    }
  });

  await t.test('8. all four together — the parameter order stays intact', async () => {
    // The actual reason for this step: the placeholders are counted up while
    // building, and the currency is appended at the very end. If one number
    // slipped, Postgres would get the currency as set number and silently return
    // nothing — no error, just an empty list.
    const liste = await M.wantedItemsOf([U.grandparent], undefined, 'EUR', {
      search: 'falcon',
      condition: 'N',
      sort: 'num_asc',
    });
    assert.deepEqual(nummern(liste), ['10179-1/N']);
    assert.equal(liste[0].market_price, 500, 'Die Währung ist beim Zählen verrutscht.');
  });

  await db.pool.end().catch(() => {});
});
