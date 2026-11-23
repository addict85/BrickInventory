/**
 * Finances with many items (UI review 17, flows M16), real bundle
 * in jsdom:
 *   - 250 sets show at most 100 rows; when the table end comes into view
 *     (marker #fin-sentinel), the next block follows until everything is there.
 *   - The search filters over all items, not only the shown ones.
 *   - The headers name/purchase price/value/G&L are buttons with aria-sort; a click
 *     sorts, a second one turns the direction.
 *   - The legend shows its signs as markup, not as text “<span”.
 *
 * Counter-checks (measured 05.11.2026, each alone, bundle rebuilt):
 *   A  FIN_BLOCK = 100000 → red: “block by block when scrolling”
 *   E  (07.11.2026) in finSentinelBinden() the observer not created →
 *      red: “block by block when scrolling” (rows stay at 100)
 *   B  in zeichneFinanzTabellen the line `if (_finSort.feld) sets.sort(…)`
 *      removed → red: “sort headers with aria-sort”
 *   C  passt() always returns true → red: “search over all items”
 *   D  (13.11.2026) in legende() the signs omitted (eintrag() without
 *      .legend-char) → red: “legend shows signs” (0 instead of 3)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, waitFor, tick, switchTab } = require('./helpers/ui');

function sets(n) {
  return Array.from({ length: n }, (_, i) => {
    const nr = String(10000 + i);
    const value = 10 + i;
    return {
      set_number: `${nr}-1`,
      name: i === 217 ? 'Seltene Burg' : `Set ${nr}`,
      quantity: 1,
      avg_price: value,
      value_total: value,
      from_cache: true,
      is_fallback: false,
      no_price: false,
      mixed: false,
      purchase_price: 5 + (i % 7),
      pnl_percent: i % 13,
      acquisitions: [],
    };
  });
}

async function openFinances(count) {
  const list = sets(count);
  const o = await openUi(
    {
      '/v2/finance/valuation': {
        success: true,
        currency: 'EUR',
        condition: 'N',
        total_value: '1',
        foreign_currency_purchases: 0,
        totals: { min: '0', avg: '1', max: '0', qty_avg: '1' },
        sets: list,
      },
      '/v2/finance/pnl': {
        success: true,
        currency: 'EUR',
        sets: [],
        totals: {
          purchase: '1',
          current: '1',
          foreign_currency_purchases: 0,
          positions: count,
          positions_valued: count,
          positions_without_market_price: 0,
          positions_without_purchase_price: 0,
          baseline_cost: '1',
          baseline_market_value: '1',
          baseline_pnl_amount: '0',
          pnl_percent: 0,
        },
      },
    },
    { browserLanguage: 'de-DE' },
  );
  // jsdom knows no scrolling: the observers are recorded, the test reports “in view” itself.
  o.observer = [];
  o.w.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback;
      o.observer.push(this);
    }
    observe(el) {
      this.el = el;
    }
    unobserve() {}
    disconnect() {
      this.separate = true;
    }
  };
  await switchTab(o.w, 'finance');
  await waitFor(() => o.d.querySelectorAll('#fin-tbl tbody tr[data-arg]').length > 0, 4000);
  return o;
}
/** The table end comes into view: the last living observer of the marker reports it. */
function inView(o) {
  const b = o.observer.filter(x => !x.separate && x.el?.id === 'fin-sentinel').at(-1);
  if (!b) return false;
  b.callback([{ isIntersecting: true }]);
  return true;
}
const lines = o => [...o.d.querySelectorAll('#fin-tbl [data-fin-kind="sets"] tbody tr[data-arg]')];

test('block by block while scrolling', async () => {
  const o = await openFinances(250);
  try {
    assert.equal(lines(o).length, 100);
    assert.equal(o.d.querySelector('#fin-tbl [data-click="finMehr"]'), null, 'the more button is gone');
    assert.ok(inView(o), 'no marker at the end of the table');
    await tick(10);
    assert.equal(lines(o).length, 200);
    assert.ok(inView(o));
    await tick(10);
    assert.equal(lines(o).length, 250);
    assert.equal(o.d.getElementById('fin-sentinel'), null, 'no marker anymore at the end');
  } finally {
    o.w.close();
  }
});

test('search over all positions', async () => {
  const o = await openFinances(250);
  try {
    const field = o.d.getElementById('fin-search');
    assert.ok(field.labels?.length || field.getAttribute('aria-label'), 'Search field without a name');
    field.value = 'seltene';
    field.dispatchEvent(new o.w.Event('input', { bubbles: true }));
    assert.ok(await waitFor(() => lines(o).length === 1, 1500), `Rows: ${lines(o).length}`);
    assert.equal(lines(o)[0].dataset.arg, '10217-1', 'Match is behind the first block');
    assert.equal(o.d.querySelector('#fin-tbl [data-click="finMehr"]'), null);
  } finally {
    o.w.close();
  }
});

test('sort headers with aria-sort', async () => {
  const o = await openFinances(30);
  try {
    const headers = [...o.d.querySelectorAll('#fin-tbl [data-fin-kind="sets"] th[aria-sort]')];
    assert.ok(headers.length >= 3, `sortable headers: ${headers.length}`);
    const button = () => o.d.querySelector('#fin-tbl [data-click="finSort"][data-arg="value"]');
    button().click();
    await tick(10);
    assert.equal(button().closest('th').getAttribute('aria-sort'), 'descending');
    assert.equal(lines(o)[0].dataset.arg, '10029-1', 'highest value first');
    assert.equal(o.d.activeElement, button(), 'Focus stays on the header');
    button().click();
    await tick(10);
    assert.equal(button().closest('th').getAttribute('aria-sort'), 'ascending');
    assert.equal(lines(o)[0].dataset.arg, '10000-1');
  } finally {
    o.w.close();
  }
});

test('legend shows symbols', async () => {
  const o = await openFinances(3);
  try {
    const legend = o.d.querySelector('#fin-tbl .fin-legend');
    assert.ok(legend, 'Legend is missing');
    assert.doesNotMatch(legend.textContent, /<span/);
    assert.equal(legend.querySelectorAll('.legend-char').length, 3);
  } finally {
    o.w.close();
  }
});
