/**
 * The G&L knows ONE purchase price: the quantity-weighted one from the entries with
 * a price in the display currency. A set whose price is only entered in another
 * currency has no known purchase price — it must not appear as
 * bought for free and thus as pure gain.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  hasCost true again as soon as there is any entry (like the
 *      old average with COALESCE(…, 0)) → red: “only entered in EUR: purchase price
 *      unknown”
 *   B  a purchase price 0 read as missing (`… || null`) → red: “an
 *      entered price 0 counts” (purchase_price null instead of 0)
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
const { holdsSet, record, catalogSet } = require('./helpers/inventory');

const NAME = `guvwaehrung_${process.pid}`;
const NR = { eur: `9${process.pid}1-1`, gemischt: `9${process.pid}2-1`, null: `9${process.pid}3-1` };

test('P&L: one purchase price, in the display currency', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'CHF')`, [uid]);
  const nummern = Object.values(NR);
  for (const nr of nummern) {
    await catalogSet(db, nr, { name: nr });
    await db.run(
      `INSERT INTO price_cache (set_number, condition, currency_code, avg_price, fetched_at)
      VALUES ($1, 'N', 'CHF', 120, NOW()) ON CONFLICT DO NOTHING`,
      [nr],
    );
  }
  const withCurrency = async (nr, menge, preis, waehrung, am) => {
    await record(db, uid, nr, menge, { preis, am });
    await db.run(
      `UPDATE set_acquisitions SET currency = $1 WHERE id = (SELECT max(id) FROM set_acquisitions WHERE user_id = $2)`,
      [waehrung, uid],
    );
  };
  await holdsSet(db, uid, NR.eur, 0);
  await withCurrency(NR.eur, 2, 100, 'EUR');
  await holdsSet(db, uid, NR.gemischt, 0);
  await withCurrency(NR.gemischt, 1, 80, 'CHF', '2026-01-02');
  await withCurrency(NR.gemischt, 3, 999, 'EUR', '2026-01-03');
  await holdsSet(db, uid, NR.null, 0);
  await withCurrency(NR.null, 1, 0, 'CHF');
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.run('DELETE FROM price_cache WHERE set_number = ANY($1)', [nummern]);
    await db.run('DELETE FROM set_catalog WHERE set_number = ANY($1)', [nummern]);
    await db.pool.end().catch(() => {});
  });

  const { gainAndLoss } = _req('src/finances/financeCalc.js');
  const pnl = await gainAndLoss(uid, [uid]);
  const zeile = nr => pnl.sets.find(s => s.set_number === nr);
  assert.equal(pnl.currency, 'CHF');

  await t.test('only captured in EUR: purchase price unknown', () => {
    const z = zeile(NR.eur);
    assert.equal(z.current_price, 120);
    assert.equal(z.purchase_price, null);
    assert.equal(z.pnl_abs, null);
    assert.equal(z.pnl_pct, null);
  });

  await t.test('mixed: only the acquisition in CHF counts', () => {
    const z = zeile(NR.gemischt);
    assert.equal(z.purchase_price, 80);
    assert.equal(z.pnl_pct, '50.0');
  });

  await t.test('a captured price of 0 counts', () => {
    // Known and 0 (gift): the amount counts, there is no
    // percentage — see gift-guv-db.test.js.
    const z = zeile(NR.null);
    assert.equal(z.purchase_price, 0);
    assert.equal(z.pnl_abs, '120.00');
    assert.equal(z.pnl_pct, null);
  });

  await t.test('the sum of the purchase price leaves out the unknown', () => {
    // 80 × 4 (mixed: the quantity counts all entries) + 0; EUR set without amount.
    assert.equal(Number(pnl.totals.sets_purchase), 80 * 4);
  });
});
