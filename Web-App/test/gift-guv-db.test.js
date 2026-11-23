/**
 * Purchase price 0 means “gift”: the server delivers purchase_price 0 (not
 * null), but no percentage — pnl_pct, pnl_prozent and kachel_pnl_pct
 * are null. The amount (pnl_betrag/pnl_abs) stays the market value. Applies to
 * sets, manual parts and minifigures, the tile and the price history.
 *
 * Computed against a lower bound of 0.01 it would say “+327,600 %”.
 *
 * Counter-checks (measured on 30.10.2026):
 *   A  in developmentPercent() (src/finances/setValue.ts) the condition `!(kauf > 0)`
 *      removed and replaced by `Math.max(kauf, 0.01)` in the denominator → red:
 *      “set”, “tile”, “price history”, “part and minifigure” (pnl_pct 1200000.0)
 *   B  in conditionRows() (src/finances/priceHistory.ts) again
 *      `purchase_price: base > 0 ? base : null` → red: “part and minifigure”
 *      (by_condition.N.purchase_price null instead of 0)
 * Counter-check (measured 08.11.2026):
 *   C  in gainAndLoss grand_total only from the sets (`sumFrom(setResults…)`) →
 *      red: “the total value comes finished …” ('240.00')
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
const { holdsSet, record, holdsPart, holdsMinifig, catalogSet } = require('./helpers/inventory');

const NAME = `geschenk_${process.pid}`;
const SET = `8${process.pid}1-1`,
  PART = `gt${process.pid}`,
  COLOR = 11,
  FIGURE = `gf${process.pid}`;

test('purchase price 0 is a gift: amount yes, percent no', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'CHF')`, [uid]);
  await catalogSet(db, SET, { name: SET });
  await db.run(
    `INSERT INTO price_cache (set_number, condition, currency_code, avg_price, fetched_at)
                VALUES ($1, 'N', 'CHF', 120, NOW()) ON CONFLICT DO NOTHING`,
    [SET],
  );
  await db.run(
    `INSERT INTO price_history (set_number, condition, currency_code, avg_price, recorded_at)
                VALUES ($1, 'N', 'CHF', 110, NOW() - INTERVAL '3 days')`,
    [SET],
  );
  await db.run(
    `INSERT INTO part_price_cache (part_number, color_id, condition, currency_code, avg_price, qty_avg_price, fetched_at)
                VALUES ($1, $2, 'N', 'CHF', 0.4, 0.4, NOW())`,
    [PART, COLOR],
  );
  await db.run(
    `INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price, qty_avg_price, fetched_at)
                VALUES ($1, 'N', 'CHF', 6, 6, NOW())`,
    [FIGURE],
  );
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.run('DELETE FROM price_cache WHERE set_number = $1', [SET]);
    await db.run('DELETE FROM price_history WHERE set_number = $1', [SET]);
    await db.run('DELETE FROM set_catalog WHERE set_number = $1', [SET]);
    await db.run('DELETE FROM part_price_cache WHERE part_number = $1', [PART]);
    await db.run('DELETE FROM minifig_price_cache WHERE fig_number = $1', [FIGURE]);
    await db.pool.end().catch(() => {});
  });

  await holdsSet(db, uid, SET, 0);
  await record(db, uid, SET, 2, { price: 0, am: '2026-01-05' });
  await holdsPart(db, uid, PART, { colorId: COLOR, quantity: 10, price: 0 });
  await holdsMinifig(db, uid, FIGURE, { quantity: 1, price: 0 });

  const { gainAndLoss } = _req('src/finances/financeCalc.js');
  const pnl = await gainAndLoss(uid, [uid]);

  await t.test('Set', () => {
    const z = pnl.sets.find(s => s.set_number === SET);
    assert.equal(z.purchase_price, 0, 'known and 0, not null');
    assert.equal(z.pnl_pct, null);
    assert.equal(z.pnl_percent, null);
    assert.equal(z.baseline_pnl_pct, null);
    assert.equal(z.pnl_amount, 240, 'the amount is the market value: 2 × 120');
    assert.equal(z.pnl_abs, '240.00');
  });

  await t.test('the total value comes ready-made: sets, parts and figures', () => {
    // 2 × 120 (set) + 10 × 0.40 (part) + 1 × 6 (minifigure); the clients do not add up themselves.
    assert.equal(pnl.totals.grand_total, '250.00');
  });

  await t.test('tile', () => {
    const z = pnl.sets.find(s => s.set_number === SET);
    assert.equal(z.tile_price, 120);
    assert.equal(z.tile_pnl_pct, null);
  });

  await t.test('price history', async () => {
    const { priceHistorySet } = _req('src/finances/priceHistory.js');
    const v = await priceHistorySet([uid], SET, 'CHF');
    assert.equal(v.purchase_price, 0);
    assert.equal(v.pnl_pct, null);
    assert.equal(v.pnl_percent, null);
    assert.equal(v.by_condition.N.purchase_price, 0);
    assert.equal(v.by_condition.N.pnl_pct, null);
    assert.equal(v.by_condition.N.market_price, 120);
  });

  await t.test('part and figure', async () => {
    const { priceHistoryPart, priceHistoryMinifig } = _req('src/finances/priceHistory.js');
    const part = await priceHistoryPart([uid], PART, COLOR, 'CHF');
    assert.deepEqual(part.by_condition.N, { market_price: 0.4, purchase_price: 0, pnl_pct: null, pnl_percent: null });
    const minifig = await priceHistoryMinifig([uid], FIGURE, 'CHF');
    assert.deepEqual(minifig.by_condition.N, { market_price: 6, purchase_price: 0, pnl_pct: null, pnl_percent: null });
    const { valueAcquisitionRows } = _req('src/finances/setValue.js');
    const [row] = valueAcquisitionRows(
      PART,
      [{ id: 1, condition: 'N', quantity: 10, unit_price: 0 }],
      new Map([[`${PART}|N`, 0.4]]),
    );
    assert.equal(row.purchase_price, 0);
    assert.equal(row.pnl_pct, null);
    assert.equal(row.pnl_percent, null);
  });
});
