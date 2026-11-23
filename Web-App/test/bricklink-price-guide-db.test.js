/**
 * The BrickLink price guide as sets, parts and minifigures query it: on
 * a dummy of bricklinkRequest (provided at the wiring,
 * testSources) and the test DB.
 * First sales of the last six months, without a price there the offers.
 *
 * Counter-checks (measured 08.11.2026, each alone):
 *   A  priceGuideQuery with default `condition = 'U'` → red: “without input the
 *      new price from the sales”
 *   B  priceGuideQuery without the fallback (`return { ...first, guide_used }`
 *      immediately) → red: “without a sale … the offers” (set)
 *   C  in fetchPartPrice or fetchMinifigPrice the fetch with guide_type
 *      'stock' deleted → red: “without a sale … the offers” (part or minifigure)
 *   D  getPriceGuideRaw asks with guide_type 'stock' first → red: “without
 *      input …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testSources } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

const fetches = [];
/** Price per guide_type; if one is missing, BrickLink delivers 0. */
let preise = {};
testSources(null, {
  bricklinkRequest: async (_method, path, params) => {
    fetches.push({ path, ...params });
    const p = String(preise[params.guide_type] ?? 0);
    return { avg_price: p, qty_avg_price: p, min_price: p, max_price: p, total_quantity: p === '0' ? '0' : '3' };
  },
});
const { priceGuideQuery } = _req('src/catalog/bricklinkPrices.js');
const { fetchPartPrice, fetchMinifigPrice } = _req('src/finances/calculation/prices.js');

const N = `${process.pid}`;
const SET = `91${N}-1`,
  PART = `pf${N}`,
  FIGURE = `pf-fig-${N}`;

test('BrickLink price guide', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  t.after(async () => {
    await db.run('DELETE FROM part_price_cache WHERE part_number = $1', [PART]).catch(() => {});
    await db.run('DELETE FROM part_price_history WHERE part_number = $1', [PART]).catch(() => {});
    await db.run('DELETE FROM minifig_price_cache WHERE fig_number = $1', [FIGURE]).catch(() => {});
    await db.run('DELETE FROM minifig_price_history WHERE fig_number = $1', [FIGURE]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  await t.test('without a value the new price from the sales', async () => {
    fetches.length = 0;
    preise = { sold: 120 };
    const g = await priceGuideQuery(SET);
    assert.deepEqual(
      fetches.map(a => [a.new_or_used, a.guide_type]),
      [['N', 'sold']],
    );
    assert.deepEqual([g.avg_price, g.guide_used], ['120', 'sold']);
  });

  await t.test('without a sale in six months the offers — for sets, parts and figures', async () => {
    preise = { sold: 0, stock: 80 };
    fetches.length = 0;
    const g = await priceGuideQuery(SET, 'U');
    assert.deepEqual(
      fetches.map(a => [a.new_or_used, a.guide_type]),
      [
        ['U', 'sold'],
        ['U', 'stock'],
      ],
    );
    assert.deepEqual([g.avg_price, g.guide_used, g.guide_fallback], ['80', 'stock', true]);

    fetches.length = 0;
    const teil = await fetchPartPrice(PART, 4, 'N', 'EUR', 24);
    assert.equal(teil.avg_price, 80, JSON.stringify(teil));
    assert.deepEqual(
      fetches.slice(0, 2).map(a => a.guide_type),
      ['sold', 'stock'],
    );
    assert.match(fetches[0].path, new RegExp(`/items/part/${PART}/price`));

    fetches.length = 0;
    const figur = await fetchMinifigPrice(FIGURE, 'N', 'EUR', 24);
    assert.equal(figur.avg_price, 80, JSON.stringify(figur));
    assert.deepEqual(
      fetches.slice(0, 2).map(a => a.guide_type),
      ['sold', 'stock'],
    );
  });
});
