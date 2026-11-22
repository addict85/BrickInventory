/**
 * Finances: key figures ALWAYS stand at the top. The cost (sum of the
 * purchase prices) is always known; total value and G&L only with market prices,
 * otherwise the tile says for how many items the price is missing. The
 * sum rows show the cost even without market value. Checked on the real
 * bundle in jsdom with responses in the server's shape.
 *
 * Counter-checks (measured on 28.10.):
 *   A  showMetrics() not called → red: both cases (“cost missing at the top”)
 *   B  summenZellen() without a cost cell → red: “without market prices”
 *      (“the sets' sum row does not show the cost”)
 *   C  counter withoutPrice without the parts → red: both cases (3 instead of 4, 2 instead of 3)
 *   E  the empty state removed in renderFinance → red: “nothing entered”
 *      (five times “missing”; 28.10.)
 *   D  G&L amount again as total value − cost → red: “with market prices”
 *      (−397.93 next to +11.3 %; 28.10.)
 *   F  the G&L tile hidden again without prices (display none) → red:
 *      “without market prices” (“G&L tile disappears”; 30.10.)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, warte } = require('./helpers/ui');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
// Both notations: de-DE (1.097,93) and de-CH (1’097.93).
const zahl = s =>
  s
    .replace(/[’'’\s]/g, '')
    .replace(/\.(?=\d{3}\b)/g, '')
    .replace(',', '.');

function antworten({ withPrice }) {
  const setPrice = withPrice ? 700 : 0;
  return {
    '/v2/finance/valuation': {
      success: true,
      currency: 'EUR',
      totals: { min: withPrice ? '650' : '0', avg: String(setPrice), max: withPrice ? '760' : '0' },
      sets: [
        {
          set_number: '10294-1',
          name: 'Titanic',
          quantity: 1,
          purchase_price: 629,
          avg_price: setPrice,
          total_avg: String(setPrice),
          value_total: setPrice,
          acquisitions: [
            {
              id: 1,
              condition: 'N',
              quantity: 1,
              purchase_price: 629,
              avg_price: setPrice || null,
              value_total: setPrice,
            },
          ],
          ...(withPrice ? {} : { error: '10294-1 — kein BrickLink-Preis gefunden' }),
        },
        {
          set_number: '42143-1',
          name: 'Ferrari',
          quantity: 1,
          purchase_price: 399,
          avg_price: 0,
          total_avg: '0',
          value_total: 0,
          acquisitions: [{ id: 2, condition: 'N', quantity: 1, purchase_price: 399, value_total: 0 }],
          error: 'kein Preis',
        },
      ],
    },
    '/v2/finance/parts-valuation': {
      success: true,
      currency: 'EUR',
      total_value: '0',
      parts: [
        {
          part_number: '3001',
          part_name: 'Brick 2 x 4',
          color_name: 'Red',
          quantity: 7,
          purchase_price: 9.99,
          avg_price: 0,
          acquisitions: [{ id: 3, condition: 'U', quantity: 7, purchase_price: 9.99 }],
        },
      ],
    },
    '/v2/finance/minifigs-valuation': {
      success: true,
      currency: 'EUR',
      total_value: '0',
      figs: [{ fig_number: 'fig-1', fig_name: 'Chewbacca', quantity: 1, avg_price: 0, acquisitions: [] }],
    },
    '/v2/finance/pnl': {
      success: true,
      currency: 'EUR',
      sets: [],
      totals: {
        purchase: '1097.93',
        sets_purchase: '1028.00',
        parts_purchase: '69.93',
        figs_purchase: '0.00',
        grand_total: String(setPrice),
        pnl_pct: withPrice ? '11.3' : null,
        pnl_percent: withPrice ? 11.3 : null,
        pnl_purchase: withPrice ? '629.00' : '0.00',
        pnl_current: withPrice ? '700.00' : '0.00',
        positions: 4,
        positions_valued: withPrice ? 1 : 0,
        positions_without_market_price: withPrice ? 3 : 4,
        positions_without_purchase_price: 0,
        baseline_cost: withPrice ? '629.00' : '0.00',
        baseline_market_value: withPrice ? '700.00' : '0.00',
        baseline_pnl_amount: withPrice ? '71.00' : '0.00',
        cost_without_market_price: withPrice ? '468.93' : '1097.93',
        market_value_without_purchase_price: '0.00',
      },
    },
  };
}

async function finanzen(opt) {
  const o = await openUi(antworten(opt));
  await reiter(o.w, 'finance');
  await warte(() => o.d.querySelector('#fin-tbl tfoot'));
  return o;
}

test('without market prices: cost basis at the top and in the sums, a hint instead of "—"', async () => {
  const { w, d } = await finanzen({ withPrice: false });
  try {
    assert.match(zahl(text(d.getElementById('fin-cost-basis'))), /1097\.93/, 'Cost basis missing at the top');
    assert.equal(text(d.getElementById('fin-value')), 'Marktpreis fehlt für 4 Positionen');
    // The G&L tile stays (the row does not jump) and says what is missing.
    assert.notEqual(d.getElementById('fin-stat-pnl').style.display, 'none', 'G&V-Kachel verschwindet');
    assert.equal(text(d.getElementById('fin-total-pnl')), '—');
    assert.equal(text(d.getElementById('fin-pnl-sub')), 'Braucht Kauf- und Marktpreise');
    const setsFuss = d.querySelector('[data-fin-kind="sets"] tfoot');
    assert.match(zahl(text(setsFuss)), /1028\.00/, 'The totals row of the sets does not show the cost basis');
    const summe = d.querySelector('.dt-sum tfoot');
    assert.match(zahl(text(summe)), /1097\.93/, 'The grand total does not show the cost basis');
  } finally {
    w.close();
  }
});

test('with market prices: total value and P&L', async () => {
  const { w, d } = await finanzen({ withPrice: true });
  try {
    assert.match(zahl(text(d.getElementById('fin-value'))), /700\.00/);
    assert.match(text(d.getElementById('fin-basis')), /3 Positionen ohne Marktpreis nicht gerechnet/);
    assert.notEqual(d.getElementById('fin-stat-pnl').style.display, 'none');
    assert.match(text(d.getElementById('fin-total-pnl')), /11[.,]3/);
    // Amount from the same items as the percentage: 700 − 629, not 700 − 1097.93.
    // Behind it stands what it is computed against; the percent in the chart computes against the period.
    assert.match(
      zahl(text(d.getElementById('fin-pnl-sub'))),
      /^\+[^0-9]*71\.00[^0-9]*$/,
      `Amount does not match the percentage: ${text(d.getElementById('fin-pnl-sub'))}`,
    );
    assert.match(text(d.getElementById('fin-pnl-sub')), /zum Kaufpreis/);
  } finally {
    w.close();
  }
});

test('nothing captured: one empty state, no "price missing"', async () => {
  const o = await openUi({});
  try {
    await reiter(o.w, 'finance');
    await warte(() => o.d.querySelector('#fin-tbl .empty-state'));
    const finanzen = text(o.d.getElementById('tab-finance'));
    assert.equal((finanzen.match(/fehlt/gi) || []).length, 0, `meldet „fehlt“: ${finanzen.slice(0, 300)}`);
    assert.match(text(o.d.querySelector('#fin-tbl .empty-state')), /Noch nichts zu bewerten/);
  } finally {
    o.w.close();
  }
});
