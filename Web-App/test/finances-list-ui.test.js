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
 *      .legende-zeichen) → red: “legend shows signs” (0 instead of 3)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte, takt, reiter } = require('./helpers/ui');

function sets(n) {
  return Array.from({ length: n }, (_, i) => {
    const nr = String(10000 + i);
    const wert = 10 + i;
    return {
      set_number: `${nr}-1`,
      name: i === 217 ? 'Seltene Burg' : `Set ${nr}`,
      quantity: 1,
      avg_price: wert,
      wert_gesamt: wert,
      from_cache: true,
      is_fallback: false,
      no_price: false,
      mixed: false,
      purchase_price: 5 + (i % 7),
      pnl_prozent: i % 13,
      acquisitions: [],
    };
  });
}

async function openFinances(anzahl) {
  const liste = sets(anzahl);
  const o = await openUi(
    {
      '/v1/finance/valuation': {
        success: true,
        currency: 'EUR',
        condition: 'N',
        total_value: '1',
        kaufpreise_fremde_waehrung: 0,
        totals: { min: '0', avg: '1', max: '0', qty_avg: '1' },
        sets: liste,
      },
      '/v1/finance/pnl': {
        success: true,
        currency: 'EUR',
        sets: [],
        totals: {
          purchase: '1',
          current: '1',
          kaufpreise_fremde_waehrung: 0,
          positionen: anzahl,
          positionen_bewertet: anzahl,
          positionen_ohne_marktpreis: 0,
          positionen_ohne_kaufpreis: 0,
          basis_einstand: '1',
          basis_marktwert: '1',
          basis_guv_betrag: '0',
          pnl_prozent: 0,
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
      this.getrennt = true;
    }
  };
  await reiter(o.w, 'finance');
  await warte(() => o.d.querySelectorAll('#fin-tbl tbody tr[data-arg]').length > 0, 4000);
  return o;
}
/** The table end comes into view: the last living observer of the marker reports it. */
function inSicht(o) {
  const b = o.observer.filter(x => !x.getrennt && x.el?.id === 'fin-sentinel').at(-1);
  if (!b) return false;
  b.callback([{ isIntersecting: true }]);
  return true;
}
const zeilen = o => [...o.d.querySelectorAll('#fin-tbl [data-fin-art="sets"] tbody tr[data-arg]')];

test('block by block while scrolling', async () => {
  const o = await openFinances(250);
  try {
    assert.equal(zeilen(o).length, 100);
    assert.equal(o.d.querySelector('#fin-tbl [data-click="finMehr"]'), null, 'der Weitere-Knopf ist weg');
    assert.ok(inSicht(o), 'keine Markierung am Tabellenende');
    await takt(10);
    assert.equal(zeilen(o).length, 200);
    assert.ok(inSicht(o));
    await takt(10);
    assert.equal(zeilen(o).length, 250);
    assert.equal(o.d.getElementById('fin-sentinel'), null, 'am Ende keine Markierung mehr');
  } finally {
    o.w.close();
  }
});

test('search over all positions', async () => {
  const o = await openFinances(250);
  try {
    const feld = o.d.getElementById('fin-suche');
    assert.ok(feld.labels?.length || feld.getAttribute('aria-label'), 'Suchfeld ohne Namen');
    feld.value = 'seltene';
    feld.dispatchEvent(new o.w.Event('input', { bubbles: true }));
    assert.ok(await warte(() => zeilen(o).length === 1, 1500), `Zeilen: ${zeilen(o).length}`);
    assert.equal(zeilen(o)[0].dataset.arg, '10217-1', 'Treffer liegt hinter dem ersten Block');
    assert.equal(o.d.querySelector('#fin-tbl [data-click="finMehr"]'), null);
  } finally {
    o.w.close();
  }
});

test('sort headers with aria-sort', async () => {
  const o = await openFinances(30);
  try {
    const headers = [...o.d.querySelectorAll('#fin-tbl [data-fin-art="sets"] th[aria-sort]')];
    assert.ok(headers.length >= 3, `sortierbare Köpfe: ${headers.length}`);
    const knopf = () => o.d.querySelector('#fin-tbl [data-click="finSortiere"][data-arg="wert"]');
    knopf().click();
    await takt(10);
    assert.equal(knopf().closest('th').getAttribute('aria-sort'), 'descending');
    assert.equal(zeilen(o)[0].dataset.arg, '10029-1', 'höchster Wert zuerst');
    assert.equal(o.d.activeElement, knopf(), 'Fokus bleibt auf dem Kopf');
    knopf().click();
    await takt(10);
    assert.equal(knopf().closest('th').getAttribute('aria-sort'), 'ascending');
    assert.equal(zeilen(o)[0].dataset.arg, '10000-1');
  } finally {
    o.w.close();
  }
});

test('legend shows symbols', async () => {
  const o = await openFinances(3);
  try {
    const legende = o.d.querySelector('#fin-tbl .fin-legende');
    assert.ok(legende, 'Legende fehlt');
    assert.doesNotMatch(legende.textContent, /<span/);
    assert.equal(legende.querySelectorAll('.legende-zeichen').length, 3);
  } finally {
    o.w.close();
  }
});
