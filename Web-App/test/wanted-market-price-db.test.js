/**
 * The wishlist shows the market price — namely that of the right condition.
 *
 * ── Counter-checks (performed, result in the commit) ─────────────────────────
 *   a) condition clause in the JOIN removed → steps 2 and 5 red.
 *   b) currency clause in the JOIN removed → all five red (the row then
 *      finds three price rows instead of one and multiplies the result).
 *   c) Number() omitted → STAYED GREEN. That is not a flaw of the test,
 *      but a measurement: db/database.ts:63 sets a type parser that already
 *      returns NUMERIC as a number. The conversion is thus a safety net and
 *      not a conversion — the comment at that place now says so too.
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
  await db.run(`INSERT INTO users (username, password_hash) VALUES ('ich','x')`);
  U.ich = (await db.get(`SELECT id FROM users WHERE username='ich'`)).id;

  // Two wishlist items for the SAME set, in both conditions — the most
  // important statement depends on that.
  for (const c of ['N', 'U']) {
    await db.run(`INSERT INTO wanted (user_id, set_number, condition) VALUES ($1,'10179-1',$2)`, [U.ich, c]);
  }
  await db.run(`INSERT INTO wanted (user_id, set_number, condition) VALUES ($1,'75192-1','N')`, [U.ich]);

  // Prices: new 500, used 300 — and in a DIFFERENT currency a
  // deviating value, so that a missing currency comparison stands out.
  for (const [c, p, w] of [
    ['N', 500, 'EUR'],
    ['U', 300, 'EUR'],
    ['N', 999, 'CHF'],
  ]) {
    await db.run(
      `INSERT INTO price_cache (set_number, condition, currency_code, avg_price)
       VALUES ('10179-1',$1,$2,$3)`,
      [c, w, p],
    );
  }
  // 75192-1 stays without a price — "none in the cache yet" is a valid case.
}

async function dbReachable() {
  try {
    await db.get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

test('wishlist: market price from the cache', async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    keineDb(t);
    return;
  }
  await seed();
  const M = _req('src/wanted/wanted.js');

  await t.test('1. the price arrives as a number', async () => {
    // That it does so is due to the type parser in db/database.ts (counter-check c),
    // not to the Number() in the wishlist code. The check
    // stays here anyway: if the parser went away, both UIs would later
    // compare text, and that would otherwise only show up when sorting.
    const liste = await M.wantedItemsOf([U.ich], undefined, 'EUR');
    const neu = liste.find(w => w.set_number === '10179-1' && w.condition === 'N');
    assert.equal(typeof neu.market_price, 'number', `marktpreis ist ${typeof neu.market_price}`);
    assert.equal(neu.market_price, 500);
    assert.equal(neu.currency, 'EUR');
  });

  await t.test('2. every condition gets ITS price', async () => {
    // Without the condition clause in the JOIN the used wishlist item would show
    // the new price — and nobody could tell from the number.
    const liste = await M.wantedItemsOf([U.ich], undefined, 'EUR');
    const karte = Object.fromEntries(
      liste.filter(w => w.set_number === '10179-1').map(w => [w.condition, w.market_price]),
    );
    assert.deepEqual(karte, { N: 500, U: 300 }, 'Der gebrauchte Merkposten zeigt nicht den Gebrauchtpreis.');
  });

  await t.test("3. the reader's currency decides", async () => {
    const chf = await M.wantedItemsOf([U.ich], undefined, 'CHF');
    const neu = chf.find(w => w.set_number === '10179-1' && w.condition === 'N');
    assert.equal(neu.market_price, 999, 'Der Preis stammt aus der falschen Währung.');
    assert.equal(neu.currency, 'CHF');
  });

  await t.test('4. no price in the cache means null, not 0', async () => {
    // 0 would be "worthless", null is "none there yet" — the UIs show
    // a dash for it. The difference is that between a statement and
    // a missing statement.
    const liste = await M.wantedItemsOf([U.ich], undefined, 'EUR');
    const ohne = liste.find(w => w.set_number === '75192-1');
    assert.equal(ohne.market_price, null);
  });

  await t.test('5. the filter on ONE set still works', async () => {
    // The currency has become an additional parameter; its number depends
    // on whether the set filter is set. Exactly there a transposed number
    // would arise, and it would be silent: Postgres would get the currency as
    // set number and return nothing.
    const eins = await M.wantedItemsOf([U.ich], '10179-1', 'EUR');
    assert.equal(eins.length, 2, `${eins.length} Zeilen statt 2 — Parameterfolge verrutscht?`);
    assert.ok(eins.every(w => w.set_number === '10179-1'));
    assert.equal(eins.find(w => w.condition === 'U').market_price, 300);
  });

  await db.pool.end().catch(() => {});
});
