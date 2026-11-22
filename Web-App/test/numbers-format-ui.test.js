/**
 * Percentages and amounts in the same notation — on the real bundle in jsdom.
 *
 *   - On the set tile the P&L stands in the form of the UI language:
 *     de-DE „+51,1 %“ next to „411,90 €“, en-GB „+51.1%“ next to „€411.90“, never mixed.
 *
 * Counter-check (measured on 28.10.2026):
 *   A  pnlBadge() again `${v>0?'+':''}${v.toFixed(1)}%` → red: “de-DE: P&L
 *      on the tile in the UI's form” (actual „+51.1%“)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte } = require('./helpers/ui');

const SET = {
  set_number: '10300-1',
  name: 'Zeitmaschine',
  year: 2022,
  theme: 'Icons',
  quantity: 1,
  added_at: '2026-10-01T00:00:00Z',
  avg_purchase_price: 272.5,
  conditions: ['N'],
};
const RESPONSES = {
  '/v2/sets': { success: true, sets: [SET], total: 1, themes: [] },
  '/v2/finance/pnl': {
    success: true,
    currency: 'EUR',
    sets: [
      {
        set_number: '10300-1',
        quantity: 1,
        current_price: 411.9,
        pnl_pct: '51.1',
        baseline_price: 272.5,
        tile_price: 411.9,
        tile_pnl_pct: 51.1,
      },
    ],
    totals: {},
  },
};

for (const [language, browser, preis, guv] of [
  ['de', 'de-DE', '411,90 €', '+51,1 %'],
  ['en', 'en-GB', '€411.90', '+51.1%'],
]) {
  test(`${browser}: P&L on the tile in the UI's form`, async () => {
    const { w, d } = await openUi(RESPONSES, { language, browserLanguage: browser });
    try {
      await warte(() => d.querySelector('[data-price-for="10300-1"] .pnl-pos'));
      const field = d.querySelector('[data-price-for="10300-1"]');
      assert.ok(field, 'No price row on the tile');
      const text = field.textContent.replace(/ /g, ' ');
      assert.ok(text.includes(preis), `price: „${text}“`);
      assert.equal(field.querySelector('.pnl-pos').textContent.replace(/ /g, ' '), guv);
    } finally {
      w.close();
    }
  });
}
