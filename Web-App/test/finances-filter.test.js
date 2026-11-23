/**
 * The category filter of the finances: three kinds (as in the app), “empty means all”, additive.
 * The web app runs in jsdom (real bundle).
 *
 * Counter-checks (measured 10.11.2026, each alone, reverted, bundle rebuilt):
 *   A  finFilter() replaces the selection (`finKategorien.clear()` before adding) → red:
 *      “web app: the filter accumulates …”
 *   B  in the drawing function the call `finFilterAnwenden();` after setHtml deleted → red:
 *      “web app: … survives redrawing”
 *   C  in the markup the chip data-arg="figs" to "minifigs" → red: “the three kinds …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, switchTab, waitFor } = require('./helpers/ui');

const items = (field, nr, name) => ({
  [`${field}_number`]: nr,
  [`${field}_name`]: name,
  quantity: 1,
  condition: 'N',
  conditions: ['N'],
  acquisitions: [],
  avg_price: 2,
  purchase_price: 1,
  value_total: 2,
  total_value: '2.00',
  display_value: '2.00',
});

async function finances() {
  const o = await openUi({
    '/v2/finance/valuation': {
      success: true,
      currency: 'EUR',
      condition: 'N',
      total_value: '5',
      foreign_currency_purchases: 0,
      totals: { min: '0', avg: '5', max: '0', qty_avg: '5' },
      sets: [
        {
          set_number: '10294-1',
          name: 'Titanic',
          quantity: 1,
          avg_price: 5,
          value_total: 5,
          from_cache: true,
          is_fallback: false,
          no_price: false,
          mixed: false,
          acquisitions: [],
        },
      ],
    },
    '/v2/finance/parts-valuation': {
      success: true,
      currency: 'EUR',
      total_value: '2',
      value_total: 2,
      parts: [{ ...items('part', '3001', 'Stein 2 x 4'), color_id: 5, color_name: 'Red' }],
    },
    '/v2/finance/minifigs-valuation': {
      success: true,
      currency: 'EUR',
      total_value: '2',
      value_total: 2,
      figs: [items('fig', 'sw0001', 'Luke')],
    },
  });
  await switchTab(o.w, 'finance');
  assert.ok(
    await waitFor(() => o.d.querySelectorAll('#fin-tbl [data-fin-kind]').length === 3),
    'not all three sections there',
  );
  o.visible = () =>
    [...o.d.querySelectorAll('#fin-tbl [data-fin-kind]')]
      .filter(el => el.style.display !== 'none')
      .map(el => el.dataset.finKind);
  o.chip = kind => o.d.querySelector(`#fin-filter [data-click="finFilter"][data-arg="${kind}"]`).click();
  return o;
}

test('the three kinds, and each has a section', async () => {
  const kinds = ['sets', 'parts', 'figs'];
  const o = await finances();
  try {
    const webKinds = [...o.d.querySelectorAll('#fin-filter [data-click="finFilter"]')].map(b => b.dataset.arg);
    assert.deepEqual(webKinds, ['all', ...kinds]);
    // A chip without a matching section would be a button that does nothing.
    assert.deepEqual(o.visible(), kinds);
  } finally {
    o.w.close();
  }
});

test('web app: empty means all, the filter accumulates and survives redrawing', async () => {
  const o = await finances();
  try {
    o.chip('parts');
    assert.deepEqual(o.visible(), ['parts']);
    o.chip('figs');
    assert.deepEqual(o.visible(), ['parts', 'figs'], 'a second chip replaces the selection instead of piling it up');
    assert.equal(o.d.querySelector('#fin-filter [data-arg="figs"]').getAttribute('aria-pressed'), 'true');
    o.chip('parts');
    assert.deepEqual(o.visible(), ['figs'], 'a second click does not take the kind out again');
    // The search redraws the table: the old section is replaced.
    const prior = o.d.querySelector('#fin-tbl [data-fin-kind="figs"]');
    const field = o.d.getElementById('fin-search');
    field.value = '0';
    field.dispatchEvent(new o.w.Event('input', { bubbles: true }));
    assert.ok(
      await waitFor(() => !prior.isConnected && o.d.querySelectorAll('#fin-tbl [data-fin-kind]').length === 3, 1500),
      'not redrawn',
    );
    assert.deepEqual(o.visible(), ['figs']);
    o.chip('figs');
    assert.deepEqual(o.visible(), ['sets', 'parts', 'figs'], 'no selection means all');
    assert.equal(o.d.querySelector('#fin-filter [data-arg="all"]').getAttribute('aria-pressed'), 'true');
  } finally {
    o.w.close();
  }
});
