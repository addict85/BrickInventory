/**
 * The valuation reads the price cache in one query instead of per position, and
 * the set quantity only sums the acquisitions of the requested accounts.
 *
 * Counted on the pool as in valuation-queries-db.test.js; for the set quantity
 * the rows count that the scan on set_acquisitions delivers according to EXPLAIN.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  the store not passed on in valueParts → red:
 *      “twelve parts, one query on the parts cache”
 *   B  the same in valueMinifigs → red: “six minifigures, …”
 *   C  the account filter ignored in setQuantityJoin → red: “the set quantity only reads
 *      the entries of the requested accounts”
 *   D  inAccountCurrency always delivers TRUE → red: “the average purchase price
 *      of the gallery only counts the account currency” (200 instead of 100)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { holdsPart, holdsMinifig, holdsSet } = require('./helpers/inventory');

const gesehen = [];
let count = false;
// Counted in the pools of the app (runtime, system and web system role), not in the access of the test data.
const zugang = require('./helpers/sources').testAccess();
const pools = [...new Set([zugang.pool, zugang.systemPool, zugang.systemWebPool])];
const altQuery = pools.map(p => p.query);
for (const [i, p] of pools.entries())
  p.query = (text, ...rest) => {
    if (count) gesehen.push(String(typeof text === 'string' ? text : text?.text || '').replace(/\s+/g, ' '));
    return altQuery[i].call(p, text, ...rest);
  };
/** The queries during fn, filtered on a pattern. */
async function queryList(muster, fn) {
  gesehen.length = 0;
  count = true;
  try {
    return { ergebnis: await fn(), treffer: () => gesehen.filter(q => muster.test(q)).length };
  } finally {
    count = false;
  }
}

test('valuation and set quantity without row-by-row queries', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const ID = process.pid;
  const NAME = `bewertung-${ID}`,
    FREMD = `bewertung-fremd-${ID}`;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, FREMD]]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [NAME])).id;
  const fremd = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [FREMD])).id;
  const parts = Array.from({ length: 12 }, (_, i) => `bw${ID}t${i}`);
  const minifigs = Array.from({ length: 6 }, (_, i) => `bw${ID}f${i}`);
  t.after(async () => {
    for (const [i, p] of pools.entries()) p.query = altQuery[i];
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, fremd]]);
    await db.run('DELETE FROM part_price_cache WHERE part_number = ANY($1)', [parts]);
    await db.run('DELETE FROM minifig_price_cache WHERE fig_number = ANY($1)', [minifigs.map(f => f + 'bl')]);
    await db.run(`DELETE FROM bl_mapping WHERE type = 'fig' AND rb_id = ANY($1)`, [minifigs]);
    await db.pool.end().catch(() => {});
  });

  for (const nr of parts) {
    await holdsPart(db, uid, nr, { quantity: 2, preis: 1 });
    await db.run(
      `INSERT INTO part_price_cache (part_number, color_id, condition, currency_code, avg_price, qty_avg_price)
                  VALUES ($1, 0, 'N', 'EUR', 1.5, 1.4)`,
      [nr],
    );
  }
  for (const nr of minifigs) {
    await holdsMinifig(db, uid, nr, { quantity: 1, preis: 3 });
    await db.run(`INSERT INTO bl_mapping (type, rb_id, bl_id) VALUES ('fig', $1, $2)`, [nr, nr + 'bl']);
    await db.run(
      `INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price, qty_avg_price)
                  VALUES ($1, 'N', 'EUR', 4, 4)`,
      [nr + 'bl'],
    );
  }
  const { valueParts, valueMinifigs } = _req('src/finances/financeCalc.js');

  await t.test('twelve parts, one query on the parts cache', async () => {
    const m = await queryList(/FROM part_price_cache/, () => valueParts(uid, [uid]));
    assert.equal(m.ergebnis.parts.length, 12);
    assert.ok(
      m.ergebnis.parts.every(p => Number(p.avg_price) === 1.5),
      'not every part came from the cache',
    );
    assert.equal(m.treffer(), 1, `${m.treffer()} queries on part_price_cache`);
  });

  await t.test('six minifigures, one query on the minifigure cache', async () => {
    const m = await queryList(/FROM minifig_price_cache/, () => valueMinifigs(uid, [uid]));
    assert.equal(m.ergebnis.figs.length, 6);
    assert.ok(
      m.ergebnis.figs.every(f => Number(f.avg_price) === 4),
      'not every figure came from the cache',
    );
    assert.equal(m.treffer(), 1, `${m.treffer()} queries on minifig_price_cache`);
  });

  await t.test('the set quantity only reads the entries of the requested accounts', async () => {
    await holdsSet(db, uid, `bw${ID}-1`, 2);
    for (let i = 0; i < 40; i++) await holdsSet(db, fremd, `bw${ID}x${i}-1`, 1);
    const { setQuantityJoin, quantityFrom } = _req('db/stockQuantity.js');
    const plan = await db.get(
      `EXPLAIN (ANALYZE, FORMAT JSON)
       SELECT s.set_number, ${quantityFrom('sm', 0)} AS quantity
         FROM sets s ${setQuantityJoin('s', 'sm', '= ANY($1)')}
        WHERE s.user_id = ANY($1)`,
      [[uid]],
    );
    /** All nodes that read set_acquisitions, and their delivered rows. */
    const zeilen = [];
    (function lauf(k) {
      if (k['Relation Name'] === 'set_acquisitions') zeilen.push(k['Actual Rows']);
      for (const u of k.Plans || []) lauf(u);
    })(plan['QUERY PLAN'][0].Plan);
    assert.ok(zeilen.length > 0, 'no scan on set_acquisitions in the plan');
    assert.ok(
      zeilen.every(n => n <= 1),
      `acquisitions read: ${zeilen.join(', ')}`,
    );
  });

  await t.test('the average purchase price of the gallery only counts the account currency', async () => {
    const SN = `bw${ID}w-1`;
    await db.run(
      `INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'CHF')
                  ON CONFLICT (user_id, key) DO UPDATE SET value = 'CHF'`,
      [uid],
    );
    await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2)', [uid, SN]);
    for (const [preis, currency] of [
      [100, 'CHF'],
      [300, 'EUR'],
    ])
      await db.run(
        `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency)
                    VALUES ($1, $2, 1, $3, 'N', $4)`,
        [uid, SN, preis, currency],
      );
    const { readSets } = require('./helpers/sources').areaPage('sets');
    const r = await readSets([uid], {});
    const row = (r.sets || r).find(z => z.set_number === SN);
    assert.ok(row, 'the set is missing in the list');
    assert.equal(Number(row.avg_purchase_price), 100);
  });
});
