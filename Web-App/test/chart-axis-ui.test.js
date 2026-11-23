/**
 * Charts without empty area and without overlap (UI review 03.11.2026, N1):
 *   - The price history starts at the first market price; an earlier purchase stands
 *     as a point at the left edge instead of spanning three empty months.
 *   - The label of the cost line stands below the line when the …
 *
 * Counter-checks (measured on 03.11.2026):
 *   A  in priceChartSVG back to `first = axis[0]` → red: “axis from the first market price”
 *   B  in referenceLine `below` always false → red: “cost label moves out of the way”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, switchTab, waitFor } = require('./helpers/ui');

const SET = {
  set_number: '21318-1',
  name: 'Tree House',
  theme: 'Ideas',
  year: 2019,
  quantity: 1,
  conditions: ['N'],
  avg_purchase_price: 199.99,
  last_purchase: '2026-06-01T10:00:00Z',
  instructions: [],
};

test('axis from the first market price, purchase at the edge', async () => {
  const pastEntries = [
    { recorded_at: '2026-06-01', avg_price: 199.99, is_purchase_price: true },
    { recorded_at: '2026-09-01', avg_price: 186 },
    { recorded_at: '2026-10-01', avg_price: 190 },
  ];
  const { w, d } = await openUi({
    '/v2/sets': { success: true, sets: [SET], total: 1, themes: [] },
    '/v2/sets/21318-1': { success: true, set: SET },
    '/v2/sets/21318-1/price-history': {
      success: true,
      currency: 'EUR',
      history_new: pastEntries,
      history_used: [],
      by_condition: { N: { purchase_price: 199.99, market_price: 190 } },
      chart: {
        x: pastEntries.map(h => h.recorded_at),
        values: [
          { name: 'N', firstRealIndex: 0, values: pastEntries.map(h => ({ x: h.recorded_at, y: h.avg_price })) },
        ],
      },
    },
  });
  try {
    await waitFor(() => d.querySelector('#gallery [data-click="openModal"]'));
    d.querySelector('#gallery [data-click="openModal"]').click();
    await waitFor(() => d.querySelector('#set-modal svg.chart-price'), 4000);
    const svg = d.querySelector('#set-modal svg.chart-price');
    const links = Number(svg.querySelector('line').getAttribute('x1'));
    const firstOne = Number(svg.querySelector('polyline').getAttribute('points').trim().split(/\s+/)[0].split(',')[0]);
    assert.equal(firstOne, links, 'Axis from the first market price');
    assert.equal(Number(svg.querySelector('.purchase-dot').getAttribute('cx')), links, 'Purchase at the left edge');
  } finally {
    w.close();
  }
});

test('cost basis label moves aside', async () => {
  // Cost 1530, the curve ends at 1545 — just above it.
  const { w, d } = await openUi({
    '/v2/finance/valuation': {
      success: true,
      currency: 'EUR',
      totals: { min: '0', avg: '1545', max: '0' },
      sets: [
        {
          set_number: '10294-1',
          name: 'Titanic',
          quantity: 1,
          purchase_price: 1530,
          avg_price: 1545,
          value_total: 1545,
          acquisitions: [],
        },
      ],
    },
    '/v2/finance/pnl': {
      success: true,
      currency: 'EUR',
      sets: [],
      totals: {
        purchase: '1530.00',
        grand_total: '1545.00',
        pnl_percent: 1,
        positions: 1,
        positions_valued: 1,
        positions_without_market_price: 0,
        positions_without_purchase_price: 0,
        baseline_cost: '1530.00',
        baseline_market_value: '1545.00',
        baseline_pnl_amount: '15.00',
      },
    },
    '/v2/finance/portfolio-history': {
      success: true,
      currency: 'EUR',
      data_points: 3,
      period_change_pct: 0.5,
      points: [
        { x_label: 'a', value: 1900 },
        { x_label: 'b', value: 1700 },
        { x_label: 'c', value: 1545 },
      ],
    },
  });
  try {
    await switchTab(w, 'finance');
    await waitFor(() => d.querySelector('#portfolio-chart .cost-basis-line'));
    const g = d.querySelector('#portfolio-chart .cost-basis-line');
    const lineY = Number(g.querySelector('line').getAttribute('y1'));
    const textY = Number(g.querySelector('text').getAttribute('y'));
    assert.ok(textY > lineY, `Cost-basis label moves away: text ${textY}, line ${lineY}`);
  } finally {
    w.close();
  }
});
