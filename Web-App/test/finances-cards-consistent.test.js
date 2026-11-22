/**
 * Finances: the cards cost, market value and gain/loss never contradict
 * each other. The server computes them over the same items (with purchase and
 * market price, gifts with 0), the UI shows exactly these numbers and
 * names what is not computed. What is checked is the real server computation
 * (baseTheMetrics) through the real bundle in jsdom.
 *
 * Counter-checks (measured on 03.11.2026):
 *   A  in showMetrics() again costAll instead of basis.einstand → red:
 *      “cost + G/L = market value”
 *   B  in comparableSums() again only purchase price > 0 (gift out) → red:
 *      both tests
 *   C  in baseTheMetrics() withoutPurchase not counted → red: “server: gift
 *      counts along …” (counter [11, 5, 6, 0])
 *   D  chart header back to grandTotal → red: “chart header = market value card”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const _req = require('./helpers/sources').buildAndRequire();
const { baseTheMetrics, totalGuvPercent } = _req('src/finances/calculation/profitLoss.js');
const { openUi, reiter, warte } = require('./helpers/ui');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
/** Number from formatted text, whatever separators the language sets: “1’863.90”, “1.863,90 €”, “−21,8 %”. */
const betrag = s => {
  const m = String(s).match(/([−+-]?)\s*(\d[\d’'.,\u202f\u00a0]*)/);
  if (!m) return NaN;
  const roh = m[2].replace(/[’'\u202f\u00a0]/g, '').replace(/[.,]$/, '');
  const dec = roh.match(/[.,](\d{1,2})$/);
  const ganz = (dec ? roh.slice(0, -dec[0].length) : roh).replace(/[.,]/g, '');
  const v = Number(ganz + (dec ? '.' + dec[1] : ''));
  return m[1] === '−' || m[1] === '-' ? -v : v;
};

// As in the account “anna”: three sets with both prices, one gift, four sets
// without market price, one set without purchase price, a part and a minifigure without market price.
const SETS = [
  ['10294-1', 679.99, 712.4],
  ['75192-1', 650, 801.5],
  ['10300-1', 0, 163.8],
  ['21318-1', 199.99, 186.2],
  ['42115-1', 99.99, 0],
  ['60337-1', 99.99, 0],
  ['10497-1', 99.99, 0],
  ['71043-1', 99.99, 0],
  ['40000-1', null, 45],
];
const zeilen = [
  ...SETS.map(([, k, m]) => ({ purchase_price: k, current_price: m, quantity: 1 })),
  { purchase_price: 0.12, current_price: 0, quantity: 250 },
  { purchase_price: 4.5, current_price: 0, quantity: 2 },
];

test('server: a gift counts, without market or purchase price not', () => {
  const b = baseTheMetrics(zeilen);
  assert.equal(b.baseline_market_value, '1863.90');
  assert.equal(b.baseline_cost, '1529.98');
  assert.equal(b.baseline_pnl_amount, '333.92');
  assert.deepEqual(
    [b.positions, b.positions_valued, b.positions_without_market_price, b.positions_without_purchase_price],
    [11, 4, 6, 1],
  );
  assert.equal(b.cost_without_market_price, '438.96');
  assert.equal(b.market_value_without_purchase_price, '45.00');
  assert.equal(totalGuvPercent(zeilen), '21.8');
});

test('UI: cost basis + P/L = market value, percent matches, basis named', async () => {
  const b = baseTheMetrics(zeilen);
  const pct = totalGuvPercent(zeilen);
  const sets = SETS.map(([nr, k, m]) => ({
    set_number: nr,
    name: nr,
    quantity: 1,
    purchase_price: k,
    avg_price: m,
    value_total: m,
    acquisitions: [],
    ...(m ? {} : { error: 'kein Preis' }),
  }));
  const { w, d } = await openUi({
    '/v2/finance/valuation': { success: true, currency: 'EUR', totals: { min: '0', avg: '1908.90', max: '0' }, sets },
    '/v2/finance/parts-valuation': {
      success: true,
      currency: 'EUR',
      total_value: '0',
      parts: [
        {
          part_number: '3001',
          part_name: 'Brick 2 x 4',
          quantity: 250,
          purchase_price: 0.12,
          avg_price: 0,
          acquisitions: [],
        },
      ],
    },
    '/v2/finance/minifigs-valuation': {
      success: true,
      currency: 'EUR',
      total_value: '0',
      figs: [
        {
          fig_number: 'fig-2',
          fig_name: 'Doc Brown',
          quantity: 2,
          purchase_price: 4.5,
          avg_price: 0,
          acquisitions: [],
        },
      ],
    },
    '/v2/finance/pnl': {
      success: true,
      currency: 'EUR',
      sets: [],
      totals: { purchase: '1968.94', grand_total: '1908.90', pnl_percent: Number(pct), pnl_pct: pct, ...b },
    },
    '/v2/finance/portfolio-history': {
      success: true,
      currency: 'EUR',
      data_points: 3,
      period_change_pct: 6.7,
      points: [
        { x_label: 'Sep', value: 1700 },
        { x_label: 'Okt', value: 1800 },
        { x_label: 'Nov', value: 1908.9 },
      ],
    },
  });
  try {
    await reiter(w, 'finance');
    await warte(() => d.querySelector('#fin-tbl tfoot') && d.getElementById('fin-sum').dataset.loaded);
    const entryPrice = betrag(text(d.getElementById('fin-cost-basis')));
    const wert = betrag(text(d.getElementById('fin-value')));
    const guv = betrag(text(d.getElementById('fin-pnl-sub')));
    const percentValue = betrag(text(d.getElementById('fin-total-pnl')));
    assert.equal(
      Math.round((entryPrice + guv) * 100),
      Math.round(wert * 100),
      `Cost basis + P/L = market value: ${entryPrice} + ${guv} ≠ ${wert}`,
    );
    assert.equal(percentValue, Math.round((guv / entryPrice) * 1000) / 10, 'Percent does not match the amount');
    assert.equal(wert, 1863.9);
    const basis = text(d.getElementById('fin-basis'));
    assert.ok(!d.getElementById('fin-basis').hidden, 'Base row is missing');
    assert.match(basis, /4 von 11 Positionen/);
    assert.match(basis, /6 Positionen ohne Marktpreis nicht gerechnet \(Kaufpreis [^)]*438[.,]96/);
    assert.match(basis, /1 Position ohne Kaufpreis nicht gerechnet/, 'Row names the position without a purchase price');
    await warte(() => text(d.getElementById('portfolio-current')) !== '—');
    assert.equal(betrag(text(d.getElementById('portfolio-current'))), wert, 'Diagrammkopf = Marktwert-Karte');
  } finally {
    w.close();
  }
});
