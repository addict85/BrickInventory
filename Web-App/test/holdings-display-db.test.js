/**
 * Chart and owner label follow the ACTUAL stock.
 *
 * Counter-checks (performed): chart fixed to both series again → first
 * substep red (series N,U instead of U). FILTER removed → owner substep
 * red (two names instead of one).
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
const { holdsSet, record } = require('./helpers/inventory');

test('chart and owners follow the inventory', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const MAIN = `bh-${process.pid}`,
    SUB = `bs-${process.pid}`;
  const SN = `83${(process.pid % 900) + 100}-1`;

  const aufraeumen = async () => {
    for (const tab of ['sets', 'set_acquisitions', 'price_history', 'price_cache'])
      await db.run(`DELETE FROM ${tab} WHERE set_number=$1`, [SN]).catch(() => {});
  };

  await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [MAIN, SUB]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x'),($2,'x')`, [MAIN, SUB]);
  const mainId = (await db.get(`SELECT id FROM users WHERE username=$1`, [MAIN])).id;
  const subId = (await db.get(`SELECT id FROM users WHERE username=$1`, [SUB])).id;
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [
    mainId,
    subId,
  ]);
  await aufraeumen();

  // The price job writes BOTH conditions regardless of what anyone
  // owns — exactly that is where the surplus series came from.
  for (const [cond, preis] of [
    ['N', 7.99],
    ['U', 3.94],
  ]) {
    await db.run(
      `INSERT INTO price_cache (set_number,condition,currency_code,avg_price,qty_avg_price,total_quantity)
                  VALUES ($1,$2,'CHF',$3,$3,5)`,
      [SN, cond, preis],
    );
    for (let d = 1; d >= 0; d--)
      await db.run(
        `INSERT INTO price_history (set_number,condition,currency_code,avg_price,qty_avg_price,recorded_at)
                    VALUES ($1,$2,'CHF',$3,$3, CURRENT_DATE - $4::int + interval '9 hours')`,
        [SN, cond, preis, d],
      );
  }

  // Main account: purchase price deleted → quantity 0, no entry anymore.
  await holdsSet(db, mainId, SN, 0); // Quantity 0: the entry behind it carries it
  // Sub-account: a USED copy with purchase price.
  await holdsSet(db, subId, SN, 0); // Quantity 0: the entry behind it carries it
  await db.run(
    `INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                VALUES ($1,$2,3.94,'U',1)`,
    [subId, SN],
  );

  const { priceHistorySet } = _req('src/finances/priceHistory.js');
  const { readSets } = require('./helpers/sources').handlerModule(_req);

  try {
    await t.test('the chart only shows the conditions in the inventory', async () => {
      const ph = await priceHistorySet([mainId, subId], SN, 'CHF');
      assert.deepEqual(Object.keys(ph.by_condition), ['U'], 'Precondition: only „gebraucht“ is recorded');
      assert.deepEqual(
        ph.chart.values.map(v => v.name),
        ['U'],
        'The chart carries a series for a condition that is not in the stock — ' +
          'the legend then shows „Neu“ for a set that only exists used',
      );
    });

    await t.test('low, current and high come from the same series', async () => {
      // The app reads these three numbers from the chart values. With a
      // surplus series the new prices stood there (3.94 / 7.99 / 7.99),
      // while the row above showed CHF 3.94 — two answers to
      // the same question, one below the other.
      const ph = await priceHistorySet([mainId, subId], SN, 'CHF');
      const values = ph.chart.values.flatMap(v => v.values.map(p => p.y)).filter(y => y > 0);
      assert.ok(values.length, 'no chart values');
      assert.equal(Math.max(...values), 3.94, `The maximum comes from the wrong condition: ${Math.max(...values)}`);
      assert.equal(Math.min(...values), 3.94);
    });

    await t.test('without any acquisition the history stays visible anyway', async () => {
      // Opposite direction: a set without an entered purchase price still has a
      // market value. If the rule relied stubbornly on `by_condition`, the
      // chart would be empty here — worse than one series too many.
      await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]);
      const ph = await priceHistorySet([mainId, subId], SN, 'CHF');
      assert.deepEqual(Object.keys(ph.by_condition), []);
      assert.equal(
        ph.chart.values.length,
        1,
        'Without an acquisition the condition of the holding must remain, not nothing',
      );
      await db.run(
        `INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                    VALUES ($1,$2,3.94,'U',1)`,
        [subId, SN],
      );
    });

    await t.test('an account with quantity 0 no longer stands as an owner', async () => {
      const r = await readSets([mainId, subId], {});
      const row = r.sets.find(s => s.set_number === SN);
      assert.ok(row, 'the set is missing in the gallery');
      assert.equal(row.quantity, 1, 'the household quantity is the sum');
      const namen = (row.owners || []).map(o => o.username);
      assert.deepEqual(
        namen,
        [SUB],
        `Owner label wrong: ${namen.join(',')} — an account whose purchase price was deleted ` +
          'no longer holds a copy',
      );
    });

    await t.test('if someone holds a copy again, the label comes back', async () => {
      // Without this opposite direction the test would also be green if the label
      // disappeared entirely.
      // “Hold a copy again" means: create an entry.
      await record(db, mainId, SN, 2);
      const r = await readSets([mainId, subId], {});
      const namen = (r.sets.find(s => s.set_number === SN).owners || []).map(o => o.username).sort();
      assert.deepEqual(namen, [MAIN, SUB].sort(), 'both accounts now hold copies');
    });
  } finally {
    await aufraeumen();
    await db.run(`DELETE FROM account_links WHERE main_user_id=$1`, [mainId]).catch(() => {});
    await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [MAIN, SUB]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
