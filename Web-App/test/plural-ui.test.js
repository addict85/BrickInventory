/**
 * Count words follow the plural rules of the language (Intl.PluralRules) — on the
 * real bundle in jsdom.
 *
 *   - Parts, grouped by color: „1 Sorte“ and „2 Sorten“ (en: „1 kind“,
 *     „2 kinds“), never „1 Typen“.
 *   - Finances without a market price: „Marktpreis fehlt für 1 Position“.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  pluralKey() in i18n.js always returns `key` → red: all three,
 *      e.g. „1 Typen“ and „Marktpreis fehlt für 1 Positionen“
 *   B  'parts.group_types_one' removed from locales/en.js → red: “en: groups
 *      of the parts” (the fallback to German resulted in „1 Typ“)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, warte } = require('./helpers/ui');

const TEILE = {
  '/v2/parts': {
    success: true,
    total: 3,
    parts: [
      {
        part_num: '3001',
        part_number: '3001',
        name: 'Brick 2 x 4',
        color_name: 'Red',
        color_hex: 'C91A09',
        color_id: 4,
        quantity: 4,
      },
      {
        part_num: '3003',
        part_number: '3003',
        name: 'Brick 2 x 2',
        color_name: 'Blue',
        color_hex: '0055BF',
        color_id: 1,
        quantity: 2,
      },
      {
        part_num: '3004',
        part_number: '3004',
        name: 'Brick 1 x 2',
        color_name: 'Blue',
        color_hex: '0055BF',
        color_id: 1,
        quantity: 6,
      },
    ],
  },
};

for (const [language, eins, zwei] of [
  ['de', '1 Sorte', '2 Sorten'],
  ['en', '1 kind', '2 kinds'],
]) {
  test(`${language}: groups of the parts`, async () => {
    const { w, d } = await openUi(TEILE, { language });
    try {
      await reiter(w, 'parts');
      await warte(() => d.querySelectorAll('#parts-main .parts-group').length === 2);
      const zaehler = [...d.querySelectorAll('#parts-main .parts-group .group-sub')].map(e => e.textContent.trim());
      assert.deepEqual(zaehler, [eins, zwei]);
    } finally {
      w.close();
    }
  });
}

test('finances: a position without a price', async () => {
  const { w, d } = await openUi({
    '/v2/finance/valuation': {
      success: true,
      currency: 'EUR',
      totals: { min: '0', avg: '0', max: '0', qty_avg: '0' },
      sets: [
        {
          set_number: '10300-1',
          name: 'Zeitmaschine',
          quantity: 1,
          purchase_price: 199,
          avg_price: null,
          no_price: true,
        },
      ],
    },
  });
  try {
    await reiter(w, 'finance');
    await warte(() => d.getElementById('fin-value').textContent.includes('Marktpreis'));
    assert.equal(d.getElementById('fin-value').textContent.trim(), 'Marktpreis fehlt für 1 Position');
  } finally {
    w.close();
  }
});
