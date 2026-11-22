/**
 * Purchase prices in a foreign currency and estimated purchase prices (UI review 17, H3
 * and H4), against the real server:
 *   - The sum in the purchase price dialog converts USD at the rate of the purchase day into the
 *     account currency and matches the finances sum; before, it showed
 *     3 × 260.66 USD + 2 × 354.50 EUR as “1.490,98 €”.
 *   - Every row carries `preis_konto`; without a rate it counts in `ohne_kurs`.
 *   - The valuation names `price_estimated` per entry, the set list
 *     `kaufpreis_geschaetzt` if all purchase prices are estimated.
 *
 * Counter-checks (measured 05.11.2026, each alone):
 *   A  in acquisitionsInAccountCurrency the sum again over purchase_price →
 *      red: “sum in account currency like the finances” (1490.98)
 *   B  in valueAcquisitionRows the field price_estimated omitted → red:
 *      “estimated purchase prices are marked”
 *   C  bool_and(...) AS kaufpreis_geschaetzt replaced by NULL → red:
 *      “estimated purchase prices are marked” (set list)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');

test('purchase prices in a foreign currency and estimated ones', { concurrency: 1 }, async t => {
  const db = testData();
  if (!(await dataOrSkip(t, _req))) return;
  const P = process.pid,
    NAME = `waehrung-${P}`,
    SN = '10326-1',
    GS = '10305-1';
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id=$1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  await db.run("INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'EUR')", [uid]);
  await db.run(`INSERT INTO exchange_rates (day, currency, per_eur) VALUES ('2019-03-04', 'USD', 1.25), ('2019-03-04', 'JPY', 120)
                ON CONFLICT (currency, day) DO UPDATE SET per_eur = EXCLUDED.per_eur`);
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1,$2), ($1,$3)', [uid, SN, GS]);
  await db.run(
    `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency, created_at, day)
                VALUES ($1,$2,3,260.66,'N','USD','2019-03-04 12:00','2019-03-04'), ($1,$2,2,354.50,'N','EUR','2019-03-05 12:00','2019-03-05'),
                       ($1,$3,4,308,'N','EUR','2026-11-05 12:00','2026-11-05')`,
    [uid, SN, GS],
  );
  await db.run(`UPDATE set_acquisitions SET price_estimated = true WHERE user_id=$1 AND set_number=$2`, [uid, GS]);
  const { base } = testServer(_req, { sitzung: { userId: uid }, t });
  const hole = async path => (await fetch(`${base}/api/v2/${path}`)).json();

  await t.test('sum in the account currency like the finances', async () => {
    const r = await hole(`sets/${SN}/acquisitions`);
    assert.equal(r.totals.currency, 'EUR');
    assert.equal(r.totals.without_rate, 0);
    // 3 × 260,66 / 1,25 + 2 × 354,50 = 625,584 + 709
    assert.equal(r.totals.amount, 1334.58);
    const usd = r.acquisitions.find(a => a.currency === 'USD');
    assert.equal(usd.account_price, 208.528);
    const v = await hole('finance/valuation');
    const set = v.sets.find(s => s.set_number === SN);
    const finanzen = set.acquisitions.reduce((s, a) => s + a.purchase_price * a.quantity, 0);
    assert.equal(Math.round(finanzen * 100) / 100, r.totals.amount, 'same amount as in the finances');
  });

  await t.test('without a rate not included but counted', async () => {
    await db.run(
      `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency, created_at, day)
                  VALUES ($1,$2,1,9000,'U','JPY','2010-01-01 12:00','2010-01-01')`,
      [uid, SN],
    );
    const r = await hole(`sets/${SN}/acquisitions`);
    assert.equal(r.totals.without_rate, 1);
    assert.equal(r.totals.amount, 1334.58);
    await db.run(`DELETE FROM set_acquisitions WHERE user_id=$1 AND currency='JPY'`, [uid]);
  });

  await t.test('estimated purchase prices are marked', async () => {
    const v = await hole('finance/valuation');
    const geschaetzt = v.sets.find(s => s.set_number === GS).acquisitions;
    assert.deepEqual(
      geschaetzt.map(a => a.price_estimated),
      [true],
    );
    assert.ok(v.sets.find(s => s.set_number === SN).acquisitions.every(a => !a.price_estimated));
    const liste = await hole('sets');
    assert.equal(liste.sets.find(s => s.set_number === GS).purchase_price_estimated, true);
    assert.equal(liste.sets.find(s => s.set_number === SN).purchase_price_estimated, false);
  });
});
