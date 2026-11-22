/**
 * The collection tile names where its amount comes from. Without a market price
 * the server delivers the purchase price as kachel_preis — with kachel_quelle 'purchase', and
 * the tile writes „Kaufpreis“ instead of „Marktpreis“. The values come from the
 * real server calculation (tileValues), shown by the real bundle in jsdom.
 *
 * Counter-checks (measured on 03.11.2026):
 *   A  in priceRow() again `markt = !!s._price` → red: „ohne Marktpreis“
 *      (tile showed „Marktpreis 99,99 €“)
 *   B  in tileValues() kachel_quelle always 'market' → red: „ohne Marktpreis“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const _req = require('./helpers/sources').buildAndRequire();
const { tileValues } = _req('src/finances/setValue.js');
const { openUi, warte } = require('./helpers/ui');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const row = (nr, markt, kauf) => ({
  set_number: nr,
  quantity: 1,
  current_price: markt,
  purchase_price: kauf,
  baseline_price: kauf,
  pnl_pct: null,
  baseline_pnl_pct: null,
});

test('tile price: market and purchase price labeled as the server delivers them', async () => {
  const k = tileValues([row('42115-1', 0, 99.99), row('21318-1', 186.2, 199.99)]);
  assert.equal(k.get('42115-1').tile_source, 'purchase');
  assert.equal(k.get('21318-1').tile_source, 'market');
  const { w, d } = await openUi({
    '/v2/sets': {
      success: true,
      total: 2,
      themes: [],
      sets: [
        { set_number: '42115-1', name: 'Lamborghini', year: 2020, quantity: 1, avg_purchase_price: 99.99 },
        { set_number: '21318-1', name: 'Tree House', year: 2019, quantity: 1, avg_purchase_price: 199.99 },
      ],
    },
    '/v2/finance/pnl': {
      success: true,
      currency: 'EUR',
      totals: {},
      sets: ['42115-1', '21318-1'].map(nr => ({ set_number: nr, quantity: 1, ...k.get(nr) })),
    },
  });
  try {
    await warte(() => /preis/.test(text(d.querySelector('[data-price-for="21318-1"] .price-kind'))));
    await warte(() => d.querySelector('[data-price-for="42115-1"] .price-kind'));
    assert.equal(
      text(d.querySelector('[data-price-for="42115-1"] .price-kind')),
      'Kaufpreis',
      'without a market price',
    );
    assert.equal(text(d.querySelector('[data-price-for="21318-1"] .price-kind')), 'Marktpreis');
  } finally {
    w.close();
  }
});
