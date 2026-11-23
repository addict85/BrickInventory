'use strict';
/**
 * Without a BrickLink price the minifigure price is estimated from the parts.
 *
 * Counter-checks (measured on 30.10.2026):
 *   A  in figMarketPriceWithOrigin() only [blFigNumber] tried → red: “the
 *      own number is tried at BrickLink”
 *   B  estimateMinifigsPrice() with a fixed 'N' instead of effCond → red: “in the requested
 *      condition” (2 instead of 3)
 *   C  the cache entry of the estimate no longer written → red: “the
 *      estimate is cached …”
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

test('minifigure price: BrickLink first, otherwise from the parts', { concurrency: 1 }, async t => {
  const db = testData();
  if (!(await dataOrSkip(t, _req))) return;
  const { figMarketPriceWithOrigin } = _req('src/finances/marketPrice.js');
  const P = process.pid,
    NAME = `schaetzung-${P}`;
  const FA = `fig-sa${P}`,
    FB = `fig-sb${P}`,
    FC = `fig-sc${P}`,
    TA = `sa${P}`,
    TB = `sb${P}`;
  const weg = async () => {
    await db.run('DELETE FROM users WHERE username=$1', [NAME]);
    await db.run('DELETE FROM minifig_price_cache WHERE fig_number = ANY($1)', [[FA, FB, FC]]);
    await db.run('DELETE FROM minifig_price_history WHERE fig_number = ANY($1)', [[FA, FB, FC]]);
    await db.run('DELETE FROM minifig_parts_cache WHERE fig_number = ANY($1)', [[FA, FB, FC]]);
    await db.run('DELETE FROM part_price_cache WHERE part_number = ANY($1)', [[TA, TB]]);
  };
  await weg();
  t.after(async () => {
    await weg().catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1,'currency','CHF')`, [uid]);

  await t.test('the own number is tried at BrickLink', async () => {
    await db.run(
      `INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price) VALUES ($1,'N','CHF',7)`,
      [FA],
    );
    await db.run(`INSERT INTO minifig_parts_cache (fig_number, data) VALUES ($1,$2)`, [
      FA,
      JSON.stringify([{ part_num: TA, color_id: 777, quantity: 1 }]),
    ]);
    await db.run(
      `INSERT INTO part_price_cache (part_number, color_id, condition, currency_code, avg_price) VALUES ($1,777,'N','CHF',1)`,
      [TA],
    );
    const r = await figMarketPriceWithOrigin(FA, uid, null, 'N');
    assert.deepEqual({ preis: r.price, estimated: r.estimated }, { preis: 7, estimated: false });
  });

  await t.test('without a BrickLink price it is estimated from the parts, in the requested condition', async () => {
    await db.run(`INSERT INTO minifig_parts_cache (fig_number, data) VALUES ($1,$2)`, [
      FB,
      JSON.stringify([
        { part_num: TA, color_id: 777, quantity: 2 },
        { part_num: TB, color_id: 777, quantity: 1 },
      ]),
    ]);
    await db.run(
      `INSERT INTO part_price_cache (part_number, color_id, condition, currency_code, avg_price)
                  VALUES ($1,777,'U','CHF',1.5) ON CONFLICT DO NOTHING`,
      [TA],
    );
    // Part TA: new 1, used 1.5; part TB without a price → half coverage.
    const neu = await figMarketPriceWithOrigin(FB, uid, null, 'N');
    assert.deepEqual(
      { preis: neu.price, estimated: neu.estimated, abdeckung: neu.abdeckung },
      { preis: 2, estimated: true, abdeckung: 0.5 },
    );
    const gebraucht = await figMarketPriceWithOrigin(FB, uid, null, 'U');
    assert.equal(gebraucht.price, 3, 'in the condition of the request');
  });

  await t.test('the estimate is cached and recorded', async () => {
    const z = await db.all(
      `SELECT condition, avg_price::float AS preis, estimated FROM minifig_price_cache
                             WHERE fig_number = $1 ORDER BY condition`,
      [FB],
    );
    assert.deepEqual(
      z,
      [
        { condition: 'N', preis: 2, estimated: true },
        { condition: 'U', preis: 3, estimated: true },
      ],
      'the estimate is cached',
    );
    assert.equal((await db.get('SELECT COUNT(*)::int AS n FROM minifig_price_history WHERE fig_number=$1', [FB])).n, 2);
    // Without part prices the stored value stays: no new fetch per part.
    await db.run('DELETE FROM part_price_cache WHERE part_number = $1', [TA]);
    assert.equal((await figMarketPriceWithOrigin(FB, uid, null, 'N')).price, 2);
  });

  await t.test('without a priced part there is no price, not 0', async () => {
    await db.run(`INSERT INTO minifig_parts_cache (fig_number, data) VALUES ($1,$2)`, [
      FC,
      JSON.stringify([{ part_num: TB, color_id: 777, quantity: 3 }]),
    ]);
    assert.equal((await figMarketPriceWithOrigin(FC, uid, null, 'N')).price, null);
  });
});
