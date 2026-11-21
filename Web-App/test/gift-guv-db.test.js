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
  TEIL = `gt${process.pid}`,
  FARBE = 11,
  FIGUR = `gf${process.pid}`;

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
    [TEIL, FARBE],
  );
  await db.run(
    `INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price, qty_avg_price, fetched_at)
                VALUES ($1, 'N', 'CHF', 6, 6, NOW())`,
    [FIGUR],
  );
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.run('DELETE FROM price_cache WHERE set_number = $1', [SET]);
    await db.run('DELETE FROM price_history WHERE set_number = $1', [SET]);
    await db.run('DELETE FROM set_catalog WHERE set_number = $1', [SET]);
    await db.run('DELETE FROM part_price_cache WHERE part_number = $1', [TEIL]);
    await db.run('DELETE FROM minifig_price_cache WHERE fig_number = $1', [FIGUR]);
    await db.pool.end().catch(() => {});
  });

  await holdsSet(db, uid, SET, 0);
  await record(db, uid, SET, 2, { preis: 0, am: '2026-01-05' });
  await holdsPart(db, uid, TEIL, { colorId: FARBE, menge: 10, preis: 0 });
  await holdsMinifig(db, uid, FIGUR, { menge: 1, preis: 0 });

  const { gainAndLoss } = _req('src/finances/financeCalc.js');
  const pnl = await gainAndLoss(uid, [uid]);

  await t.test('Set', () => {
    const z = pnl.sets.find(s => s.set_number === SET);
    assert.equal(z.purchase_price, 0, 'bekannt und 0, nicht null');
    assert.equal(z.pnl_pct, null);
    assert.equal(z.pnl_prozent, null);
    assert.equal(z.baseline_pnl_pct, null);
    assert.equal(z.pnl_betrag, 240, 'der Betrag ist der Marktwert: 2 × 120');
    assert.equal(z.pnl_abs, '240.00');
  });

  await t.test('the total value comes ready-made: sets, parts and figures', () => {
    // 2 × 120 (set) + 10 × 0.40 (part) + 1 × 6 (minifigure); the clients do not add up themselves.
    assert.equal(pnl.totals.grand_total, '250.00');
  });

  await t.test('tile', () => {
    const z = pnl.sets.find(s => s.set_number === SET);
    assert.equal(z.kachel_preis, 120);
    assert.equal(z.kachel_pnl_pct, null);
  });

  await t.test('price history', async () => {
    const { priceHistorySet } = _req('src/finances/priceHistory.js');
    const v = await priceHistorySet([uid], SET, 'CHF');
    assert.equal(v.purchase_price, 0);
    assert.equal(v.pnl_pct, null);
    assert.equal(v.pnl_prozent, null);
    assert.equal(v.by_condition.N.purchase_price, 0);
    assert.equal(v.by_condition.N.pnl_pct, null);
    assert.equal(v.by_condition.N.market_price, 120);
  });

  await t.test('part and figure', async () => {
    const { priceHistoryPart, priceHistoryMinifig } = _req('src/finances/priceHistory.js');
    const teil = await priceHistoryPart([uid], TEIL, FARBE, 'CHF');
    assert.deepEqual(teil.by_condition.N, { market_price: 0.4, purchase_price: 0, pnl_pct: null, pnl_prozent: null });
    const figur = await priceHistoryMinifig([uid], FIGUR, 'CHF');
    assert.deepEqual(figur.by_condition.N, { market_price: 6, purchase_price: 0, pnl_pct: null, pnl_prozent: null });
    const { valueAcquisitionRows } = _req('src/finances/setValue.js');
    const [zeile] = valueAcquisitionRows(
      TEIL,
      [{ id: 1, condition: 'N', quantity: 10, unit_price: 0 }],
      new Map([[`${TEIL}|N`, 0.4]]),
    );
    assert.equal(zeile.purchase_price, 0);
    assert.equal(zeile.pnl_pct, null);
    assert.equal(zeile.pnl_prozent, null);
  });
});
