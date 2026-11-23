'use strict';
/**
 * The price history only draws conditions for which there is an acquisition.
 *
 * Counter-checks (measured on 30.10.2026):
 *   A  in manualPriceHistory() again both conditions drawn fixed
 *      (['N', 'U'] instead of statesForHistory) → red: „nur Gebraucht wird
 *      gezeichnet“
 *   B  history_new shortened to the drawn conditions → red: „die
 *      Rohdaten bleiben vollständig“
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

test('without an entry no condition in the chart, the raw data stays', { concurrency: 1 }, async t => {
  const db = testData();
  if (!(await dataOrSkip(t, _req))) return;
  const { priceHistoryMinifig, statesForHistory } = _req('src/finances/priceHistory.js');
  const NAME = `verlauf-${process.pid}`,
    FN = `fig-vl${process.pid}`;
  const route = async () => {
    await db.run('DELETE FROM users WHERE username=$1', [NAME]);
    await db.run('DELETE FROM minifig_price_history WHERE fig_number=$1', [FN]);
  };
  await route();
  t.after(async () => {
    await route().catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  await db.run(`INSERT INTO minifigs (user_id, fig_number, source) VALUES ($1,$2,'manual')`, [uid, FN]);
  await db.run(
    `INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, unit_price, condition, currency)
                VALUES ($1,$2,1,3,'U','CHF')`,
    [uid, FN],
  );
  await db.run(
    `INSERT INTO minifig_price_history (fig_number, condition, currency_code, avg_price, recorded_at)
                VALUES ($1,'N','CHF',5,'2026-10-01'), ($1,'U','CHF',4,'2026-10-01'), ($1,'U','CHF',4.5,'2026-10-02')`,
    [FN],
  );

  const v = await priceHistoryMinifig([uid], FN, 'CHF');
  assert.deepEqual(
    v.chart.values.map(s => s.name),
    ['U'],
    'only used is drawn',
  );
  assert.equal(v.history_new.length, 1, 'the raw data stay complete');
  assert.equal(v.history_used.length, 2);

  // Without any acquisition the fallback applies: both conditions.
  assert.deepEqual(statesForHistory([], ['N', 'U']), ['N', 'U']);
});
