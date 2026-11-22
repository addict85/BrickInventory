/**
 * Money is only rounded at the end, purchase prices in a foreign currency are
 * counted instead of silently left out, the default currency comes from the account,
 * and the gallery tile gets amount and P&L ready-made from the server.
 *
 * Counter-checks (measured on 29.10.2026):
 *   A  in bewertung.ts total_avg again from the rounded unit price
 *      ((unitAvg * qty).toFixed(2)) → red: “120.3333 × 3 is 361.00” (360.99)
 *   B  kaufpreise_fremde_waehrung fixed to 0 in valueSets → red:
 *      “a purchase price in EUR is counted”
 *   C  acquisition_currency() in the database reset to the old body (account, otherwise
 *      EUR) → red: “without an account currency the installation's applies”
 *   D  tileValues() not attached in gewinnVerlust.ts → red: “the tile
 *      comes ready-made from the server”
 *   E  (30.10.) in valueParts hasCost again `acqs.length > 0` →
 *      red: “only a purchase price in EUR: no P&L” (part: kauf 0, pnl 21000 instead of null)
 *   F  (30.10.) the same in valueMinifigs → red: “only a
 *      purchase price in EUR: no P&L” (figure: kauf 0, pnl 40000 instead of null)
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

test('cents only at the end, currencies honest', { concurrency: 1 }, async t => {
  const geld = _req('src/infra/money.js');
  await t.test('120.3333 × 2 is 240.67, and 1.005 rounds to 1.01', () => {
    assert.equal(geld.rowValue(120.3333, 2), 240.67);
    assert.equal(geld.rowValue('120.3333', 2), 240.67);
    assert.equal(geld.alsText(1.005), '1.01');
    assert.equal(geld.aufRappen(-12345), -1.23);
    assert.equal(
      geld.sumFrom([
        { preis: 0.07, menge: 1000 },
        { preis: null, menge: 5 },
      ]),
      70,
    );
    const { valueSet } = _req('src/finances/setValue.js');
    const v = valueSet('X-1', [{ quantity: 2, condition: 'N' }], new Map([['X-1|N', 120.3333]]));
    assert.equal(v.total, 240.67);
    assert.equal(v.unit_price, 120.33);
  });

  if (!(await dataOrSkip(t, _req))) return;

  const NAME = `geld-${process.pid}`,
    SN = `GW${process.pid}-1`;
  const PART_EUR = `gwe${process.pid}`,
    TEIL_CHF = `gwc${process.pid}`,
    FIG = `gwf${process.pid}`;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, NAME + '-2']]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  const ohne = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME + '-2']))
    .id;
  const globalBefore = await db.get(`SELECT value FROM global_settings WHERE key='currency'`);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, ohne]]);
    await db.run('DELETE FROM price_cache WHERE set_number=$1', [SN]);
    await db.run('DELETE FROM part_price_cache WHERE part_number = ANY($1)', [[PART_EUR, TEIL_CHF]]);
    await db.run('DELETE FROM minifig_price_cache WHERE fig_number=$1', [FIG]);
    if (globalBefore) await db.run(`UPDATE global_settings SET value=$1 WHERE key='currency'`, [globalBefore.value]);
    else await db.run(`DELETE FROM global_settings WHERE key='currency'`);
    await db.pool.end().catch(() => {});
  });

  await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1,'currency','CHF')`, [uid]);
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1,$2)', [uid, SN]);
  await db.run(
    `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency, created_at)
                VALUES ($1,$2,2,100,'N','CHF','2026-01-05T12:00:00Z'), ($1,$2,1,50,'N','EUR','2026-01-06T12:00:00Z')`,
    [uid, SN],
  );
  await db.run('DELETE FROM price_cache WHERE set_number=$1', [SN]);
  await db.run(
    `INSERT INTO price_cache (set_number, currency_code, condition, avg_price, fetched_at)
                VALUES ($1,'CHF','N',120.3333,NOW())`,
    [SN],
  );

  await t.test('120.3333 × 3 is 361.00, and a purchase price in EUR is counted', async () => {
    const { valueSets } = _req('src/finances/financeCalc.js');
    const r = await valueSets(uid, [uid]);
    const set = r.sets.find(s => s.set_number === SN);
    assert.equal(set.total_avg, '361.00', '120,3333 × 3 ist 361,00');
    assert.equal(set.wert_gesamt, 361);
    assert.equal(r.totals.avg, '361.00');
    assert.equal(r.kaufpreise_fremde_waehrung, 1, 'ein Kaufpreis in EUR wird gezählt');
    assert.equal(set.purchase_price, 100, 'der EUR-Kaufpreis geht nicht in den Schnitt');
    assert.equal(set.pnl_prozent, 20.3);
    assert.equal(set.pnl_pct, '20.3');
    assert.equal(r.ttl_stunden, Number(r.ttl_hours));
  });

  await t.test('the tile comes ready-made from the server', async () => {
    const { gainAndLoss } = _req('src/finances/financeCalc.js');
    const r = await gainAndLoss(uid, [uid]);
    const zeile = r.sets.find(s => s.set_number === SN);
    assert.equal(zeile.kachel_preis, 120.33);
    assert.equal(zeile.kachel_pnl_pct, 20.3);
    assert.equal(typeof zeile.pnl_prozent, 'number');
    assert.equal(r.totals.kaufpreise_fremde_waehrung, 1);
  });

  await t.test('only a purchase price in EUR: no P&L instead of thousands of percent', async () => {
    const { holdsPart, holdsMinifig } = require('./helpers/inventory');
    await holdsPart(db, uid, PART_EUR, { colorId: 5, preis: 1 });
    await holdsPart(db, uid, TEIL_CHF, { colorId: 5, preis: 0.1 });
    await holdsMinifig(db, uid, FIG, { preis: 3 });
    await db.run(`UPDATE part_acquisitions SET currency='EUR' WHERE user_id=$1 AND part_number=$2`, [uid, PART_EUR]);
    await db.run(`UPDATE minifig_acquisitions SET currency='EUR' WHERE user_id=$1 AND fig_number=$2`, [uid, FIG]);
    for (const nr of [PART_EUR, TEIL_CHF])
      await db.run(
        `INSERT INTO part_price_cache (part_number, color_id, condition, currency_code, avg_price, qty_avg_price)
                    VALUES ($1,5,'N','CHF',2.1,2.1)`,
        [nr],
      );
    await db.run(
      `INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price) VALUES ($1,'N','CHF',4)`,
      [FIG],
    );
    const { valueParts, valueMinifigs } = _req('src/finances/financeCalc.js');
    const teile = await valueParts(uid, [uid]);
    const figuren = await valueMinifigs(uid, [uid]);
    const sicht = z => z && { markt: z.avg_price, kauf: z.purchase_price, pnl: z.pnl_prozent };
    assert.deepEqual(
      {
        eur: sicht(teile.parts.find(z => z.part_number === PART_EUR)),
        chf: sicht(teile.parts.find(z => z.part_number === TEIL_CHF)),
        figur: sicht(figuren.figs.find(z => z.fig_number === FIG)),
        fremd: [teile.kaufpreise_fremde_waehrung, figuren.kaufpreise_fremde_waehrung],
      },
      {
        eur: { markt: 2.1, kauf: null, pnl: null },
        chf: { markt: 2.1, kauf: 0.1, pnl: 2000 },
        figur: { markt: 4, kauf: null, pnl: null },
        fremd: [1, 1],
      },
    );
  });

  await t.test('several rows of a set: weighted by quantity, otherwise the purchase price', () => {
    const { tileValues } = _req('src/finances/setValue.js');
    const w = tileValues([
      {
        set_number: 'A',
        quantity: 1,
        current_price: 750,
        purchase_price: 100,
        baseline_price: 100,
        pnl_pct: '650.0',
        baseline_pnl_pct: '650.0',
      },
      {
        set_number: 'A',
        quantity: 1,
        current_price: 750,
        purchase_price: 600,
        baseline_price: 600,
        pnl_pct: '25.0',
        baseline_pnl_pct: '25.0',
      },
      {
        set_number: 'B',
        quantity: 2,
        current_price: 0,
        purchase_price: 40,
        baseline_price: 40,
        pnl_pct: null,
        baseline_pnl_pct: null,
      },
    ]);
    assert.deepEqual(w.get('A'), { kachel_preis: 750, kachel_pnl_pct: 114.3, kachel_quelle: 'markt' });
    assert.deepEqual(w.get('B'), { kachel_preis: 40, kachel_pnl_pct: null, kachel_quelle: 'kauf' });
  });

  await t.test("without an account currency the installation's applies — for acquisitions and vouchers", async () => {
    await db.run(`INSERT INTO global_settings (key, value) VALUES ('currency','GBP')
                  ON CONFLICT (key) DO UPDATE SET value='GBP'`);
    await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1,$2)', [ohne, SN]);
    await db.run('INSERT INTO set_acquisitions (user_id, set_number, quantity) VALUES ($1,$2,1)', [ohne, SN]);
    assert.equal((await db.get('SELECT currency FROM set_acquisitions WHERE user_id=$1', [ohne])).currency, 'GBP');
    const { createVoucher } = require('./helpers/sources').testArea('vouchers').vouchers;
    await createVoucher(ohne, { number: '1234567', pin: null, amount: 10, currency: null });
    await createVoucher(uid, { number: '7654321', pin: null, amount: 10, currency: null });
    const g = await db.all('SELECT user_id, currency FROM vouchers WHERE user_id = ANY($1) ORDER BY id', [[uid, ohne]]);
    assert.deepEqual(
      g.map(z => z.currency),
      ['GBP', 'CHF'],
    );
  });
});
