/**
 * A price row with avg_price 0 and qty_avg_price > 0 has ONE market price
 * (the quantity average), and valuation, G&V, value curve and price history show
 * the same — for set, part and figure. Real code, real database.
 *
 * Counter-checks (measured 13.11.2026, each reverted):
 *   A  marketPriceFrom() (src/catalog/bricklinkPrices.ts) only avg_price → red:
 *      “valuation” (unit price 0 instead of 37.5), “G&V”, “price history”; Wertkurve green
 *   B  marketPriceSql() (db/moneySql.ts) only avg_price → red: „Wertkurve“
 *      (60, the purchase price as starting point, instead of 75) and “price history”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { accessOrSkip } = require('./helpers/db');
const { holdsSet, holdsPart, holdsMinifig, catalogSet } = require('./helpers/inventory');

const NAME = `mengenschnitt_${process.pid}`;
const SET = `7${process.pid}2-1`,
  PART = `mt${process.pid}`,
  COLOR = 11,
  FIGURE = `mf${process.pid}`;
const SET_PRICE = 37.5,
  PART_PRICE = 0.25,
  MINIFIG_PRICE = 8;

test('avg_price 0 next to a quantity average: the same value everywhere', { concurrency: 1 }, async t => {
  const db = await accessOrSkip(t, _req);
  if (!db) return;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.run('DELETE FROM price_cache WHERE set_number = $1', [SET]);
    await db.run('DELETE FROM price_history WHERE set_number = $1', [SET]);
    await db.run('DELETE FROM part_price_cache WHERE part_number = $1', [PART]);
    await db.run('DELETE FROM minifig_price_cache WHERE fig_number = $1', [FIGURE]);
    await db.pool.end().catch(() => {});
  });
  await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'CHF')`, [uid]);
  await catalogSet(db, SET, { name: SET });
  await db.run(
    `INSERT INTO price_cache (set_number, condition, currency_code, min_price, avg_price, max_price, qty_avg_price, fetched_at)
     VALUES ($1, 'N', 'CHF', 30, 0, 45, $2, NOW())`,
    [SET, SET_PRICE],
  );
  await db.run(
    `INSERT INTO price_history (set_number, condition, currency_code, avg_price, qty_avg_price, recorded_at)
     VALUES ($1, 'N', 'CHF', 0, $2, NOW() - INTERVAL '2 days')`,
    [SET, SET_PRICE],
  );
  await db.run(
    `INSERT INTO part_price_cache (part_number, color_id, condition, currency_code, avg_price, qty_avg_price, fetched_at)
     VALUES ($1, $2, 'N', 'CHF', 0, $3, NOW())`,
    [PART, COLOR, PART_PRICE],
  );
  await db.run(
    `INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price, qty_avg_price, fetched_at)
     VALUES ($1, 'N', 'CHF', 0, $2, NOW())`,
    [FIGURE, MINIFIG_PRICE],
  );
  await holdsSet(db, uid, SET, 2, { price: 30 });
  await holdsPart(db, uid, PART, { colorId: COLOR, quantity: 4, price: 0.2 });
  await holdsMinifig(db, uid, FIGURE, { quantity: 1, price: 5 });

  const f = _req('src/finances/financeCalc.js');

  await t.test('valuation', async () => {
    const sets = await f.valueSets(uid, [uid]);
    const s = sets.sets.find(z => z.set_number === SET);
    assert.equal(s.avg_price, SET_PRICE);
    assert.equal(s.value_total, 75);
    const parts = await f.valueParts(uid, [uid]);
    assert.equal(parts.parts.find(z => z.part_number === PART).avg_price, PART_PRICE);
    assert.equal(parts.value_total, 1);
    const minifigs = await f.valueMinifigs(uid, [uid]);
    assert.equal(minifigs.figs.find(z => z.fig_number === FIGURE).avg_price, MINIFIG_PRICE);
    assert.equal(minifigs.value_total, MINIFIG_PRICE);
  });

  await t.test('G&V', async () => {
    const pnl = await f.gainAndLoss(uid, [uid]);
    assert.equal(pnl.sets.find(z => z.set_number === SET).current_price, SET_PRICE);
    // 2 × 37,50 + 4 × 0,25 + 1 × 8
    assert.equal(pnl.totals.grand_total, '84.00');
  });

  await t.test('Wertkurve', async () => {
    const { portfolioHistory } = _req('src/finances/portfolioHistory.js');
    const curve = await portfolioHistory(uid, [uid], 'month');
    assert.ok(curve.points.length > 0, 'no points');
    assert.equal(curve.points.at(-1).value, 75);
  });

  await t.test('price history', async () => {
    const pv = _req('src/finances/priceHistory.js');
    assert.equal((await pv.priceHistorySet([uid], SET, 'CHF')).by_condition.N.market_price, SET_PRICE);
    assert.equal((await pv.priceHistoryPart([uid], PART, COLOR, 'CHF')).by_condition.N.market_price, PART_PRICE);
    assert.equal((await pv.priceHistoryMinifig([uid], FIGURE, 'CHF')).by_condition.N.market_price, MINIFIG_PRICE);
  });
});
