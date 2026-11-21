/**
 * The category filter of the finances: three kinds (as in the app), “empty means all”, additive.
 * The web app runs in jsdom (real bundle).
 *
 * Counter-checks (measured 10.11.2026, each alone, reverted, bundle rebuilt):
 *   A  finFilter() replaces the selection (`finKategorien.clear()` before adding) → red:
 *      “web app: the filter accumulates …”
 *   B  in the drawing function the call `finFilterAnwenden();` after setzeHtml deleted → red:
 *      “web app: … survives redrawing”
 *   C  in the markup the chip data-arg="figs" to "minifigs" → red: “the three kinds …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, warte } = require('./helpers/ui');

const posten = (feld, nr, name) => ({
  [`${feld}_number`]: nr,
  [`${feld}_name`]: name,
  quantity: 1,
  condition: 'N',
  conditions: ['N'],
  acquisitions: [],
  avg_price: 2,
  purchase_price: 1,
  wert_gesamt: 2,
  total_value: '2.00',
  display_value: '2.00',
});

async function finanzen() {
  const o = await openUi({
    '/v1/finance/valuation': {
      success: true,
      currency: 'EUR',
      condition: 'N',
      total_value: '5',
      kaufpreise_fremde_waehrung: 0,
      totals: { min: '0', avg: '5', max: '0', qty_avg: '5' },
      sets: [
        {
          set_number: '10294-1',
          name: 'Titanic',
          quantity: 1,
          avg_price: 5,
          wert_gesamt: 5,
          from_cache: true,
          is_fallback: false,
          no_price: false,
          mixed: false,
          acquisitions: [],
        },
      ],
    },
    '/v1/finance/parts-valuation': {
      success: true,
      currency: 'EUR',
      total_value: '2',
      wert_gesamt: 2,
      parts: [{ ...posten('part', '3001', 'Stein 2 x 4'), color_id: 5, color_name: 'Red' }],
    },
    '/v1/finance/minifigs-valuation': {
      success: true,
      currency: 'EUR',
      total_value: '2',
      wert_gesamt: 2,
      figs: [posten('fig', 'sw0001', 'Luke')],
    },
  });
  await reiter(o.w, 'finance');
  assert.ok(
    await warte(() => o.d.querySelectorAll('#fin-tbl [data-fin-art]').length === 3),
    'nicht alle drei Abschnitte da',
  );
  o.sichtbar = () =>
    [...o.d.querySelectorAll('#fin-tbl [data-fin-art]')]
      .filter(el => el.style.display !== 'none')
      .map(el => el.dataset.finArt);
  o.chip = art => o.d.querySelector(`#fin-filter [data-click="finFilter"][data-arg="${art}"]`).click();
  return o;
}

test('the three kinds, and each has a section', async () => {
  const arten = ['sets', 'parts', 'figs'];
  const o = await finanzen();
  try {
    const webKinds = [...o.d.querySelectorAll('#fin-filter [data-click="finFilter"]')].map(b => b.dataset.arg);
    assert.deepEqual(webKinds, ['alle', ...arten]);
    // A chip without a matching section would be a button that does nothing.
    assert.deepEqual(o.sichtbar(), arten);
  } finally {
    o.w.close();
  }
});

test('web app: empty means all, the filter accumulates and survives redrawing', async () => {
  const o = await finanzen();
  try {
    o.chip('parts');
    assert.deepEqual(o.sichtbar(), ['parts']);
    o.chip('figs');
    assert.deepEqual(o.sichtbar(), ['parts', 'figs'], 'ein zweiter Chip ersetzt die Auswahl, statt sie zu häufen');
    assert.equal(o.d.querySelector('#fin-filter [data-arg="figs"]').getAttribute('aria-pressed'), 'true');
    o.chip('parts');
    assert.deepEqual(o.sichtbar(), ['figs'], 'ein zweiter Klick nimmt die Art nicht wieder heraus');
    // The search redraws the table: the old section is replaced.
    const vorher = o.d.querySelector('#fin-tbl [data-fin-art="figs"]');
    const feld = o.d.getElementById('fin-suche');
    feld.value = '0';
    feld.dispatchEvent(new o.w.Event('input', { bubbles: true }));
    assert.ok(
      await warte(() => !vorher.isConnected && o.d.querySelectorAll('#fin-tbl [data-fin-art]').length === 3, 1500),
      'nicht neu gezeichnet',
    );
    assert.deepEqual(o.sichtbar(), ['figs']);
    o.chip('figs');
    assert.deepEqual(o.sichtbar(), ['sets', 'parts', 'figs'], 'keine Auswahl heisst alle');
    assert.equal(o.d.querySelector('#fin-filter [data-arg="alle"]').getAttribute('aria-pressed'), 'true');
  } finally {
    o.w.close();
  }
});
