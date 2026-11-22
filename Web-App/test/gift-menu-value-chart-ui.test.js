/**
 * Findings of the UX review of 30.10.2026, on the real bundle in jsdom:
 *   - Purchase price 0: “gift” instead of a percentage in tile, finances table and
 *     set detail; the purchase price stands as “0,00 €”.
 *   - Pages behind the menu: no tab stays marked, the page name …
 *
 * Counter-checks (measured on 30.10.2026; B to F applied together, each
 * made exactly its own case red):
 *   A  pnlBadge without the gift branch → red: “gift in tile, table
 *      and detail” (tile showed “+163.700,0 %”)
 *   B  markGroup(null) removed in openView → red: “menu page:
 *      no tab marked” (aria-current on “Sammlung”)
 *   C  smeta-text again with substring(0,12) → red: “theme in full”
 *   D  referenceLine not drawn in the value chart → red: “value chart”
 *   E  setChartPeriod again over all .period-btn → red: “period without
 *      history” (the chip “Alle” lost active)
 *   F  de 'gallery.add.price_ph' back to “79.99” → red: “placeholder per language”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openUi, reiter, sicht, warte, takt } = require('./helpers/ui');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
// jsdom formats “1.500 €” or “EUR 1’500” depending on the environment; compared without separators.
const zahl = s => {
  const o = s.replace(/[’'\s\u00a0]/g, '');
  return /,\d\d/.test(o) ? o.replace(/\./g, '').replace(/,/g, '.') : o;
};
const SETS = {
  '/v2/sets': {
    success: true,
    total: 2,
    themes: [],
    sets: [
      {
        set_number: '10300-1',
        name: 'Back to the Future',
        year: 2022,
        theme: 'Icons / Modular Buildings Collection',
        quantity: 1,
        avg_purchase_price: 0,
        max_purchase_price: 0,
      },
      {
        set_number: '21318-1',
        name: 'Tree House',
        year: 2019,
        theme: 'Ideas',
        quantity: 1,
        avg_purchase_price: 199.99,
        max_purchase_price: 199.99,
      },
    ],
  },
  '/v2/finance/pnl': {
    success: true,
    currency: 'EUR',
    totals: { grand_total: '350', purchase: '199.99' },
    sets: [
      // The server no longer sends a percentage at purchase price 0; the tile must not show it even if it does.
      { set_number: '10300-1', tile_price: 163.8, tile_pnl_pct: 1637000 },
      { set_number: '21318-1', tile_price: 186.2, tile_pnl_pct: -6.9 },
    ],
  },
  '/v2/finance/valuation': {
    success: true,
    currency: 'EUR',
    totals: { min: '0', avg: '350', max: '0' },
    sets: [
      {
        set_number: '10300-1',
        name: 'Back to the Future',
        quantity: 1,
        purchase_price: 0,
        avg_price: 163.8,
        value_total: 163.8,
        pnl_percent: null,
        acquisitions: [
          {
            id: 1,
            condition: 'N',
            quantity: 1,
            purchase_price: 0,
            avg_price: 163.8,
            value_total: 163.8,
            pnl_percent: null,
          },
        ],
      },
    ],
  },
  '/v2/sets/10300-1': {
    success: true,
    set: { set_number: '10300-1', name: 'Back to the Future', year: 2022, quantity: 1 },
  },
  '/v2/sets/10300-1/acquisitions': {
    success: true,
    acquisitions: [{ id: 1, condition: 'N', quantity: 1, purchase_price: 0, created_at: '2026-06-01T10:00:00Z' }],
  },
  '/v2/sets/10300-1/price-history': {
    success: true,
    by_condition: { N: { market_price: 163.8, purchase_price: 0, pnl_pct: null } },
  },
};

test('gift in tile, table and detail', async () => {
  const { w, d } = await openUi(SETS);
  try {
    await warte(() => /\d/.test(text(d.querySelector('[data-price-for="10300-1"]'))));
    const kachel = text(d.querySelector('[data-price-for="10300-1"]'));
    // Since UI review 13 as a badge next to the condition, not in the price box.
    assert.match(
      text(d.querySelector('[data-price-for="10300-1"]').closest('.sc').querySelector('.sbadges')),
      /Geschenk/,
    );
    assert.doesNotMatch(kachel, /%|Geschenk/, `Kachel: ${kachel}`);
    assert.match(
      text(d.querySelector('[data-price-for="21318-1"]')),
      /[−-]6[.,]9/,
      'das andere Set behält sein Prozent',
    );

    await reiter(w, 'finance');
    await warte(() => d.querySelector('#fin-tbl tbody tr'));
    const row = d.querySelector('#fin-tbl tbody tr');
    assert.equal(text(row.querySelector('.fin-guv')), 'Geschenk');
    assert.match(zahl(text(row.querySelectorAll('.price-cell')[0])), /^(EUR)?0\.00(€)?$/);

    await reiter(w, 'gallery');
    d.querySelector('#gallery [data-click="openModal"]').click();
    await warte(() => text(d.getElementById('m-market-rows')).includes('Geschenk'));
    // Since UX review 24 (N6) also in the purchase price row “gift” instead of “0,00 €”.
    assert.match(text(d.getElementById('m-acq-summary')), /Geschenk/, 'Kaufpreis im Detail');
    assert.doesNotMatch(zahl(text(d.getElementById('m-acq-summary'))), /0\.00/, 'Kaufpreis im Detail als Betrag');
    assert.match(d.getElementById('m-img').getAttribute('src'), /set-placeholder\.svg$/);
  } finally {
    w.close();
  }
});

test('set without image: the same cube as in the tile', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const cube = html.match(/<symbol id="i-set"[^>]*>(.*?)<\/symbol>/)[1];
  const image = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'set-placeholder.svg'), 'utf8');
  for (const path of cube.match(/d="[^"]+"/g)) assert.ok(image.includes(path), `${path} fehlt im Platzhalterbild`);
});

test('menu page: no tab marked, name in the header', async () => {
  const { w, d } = await openUi({ '/v2/auth/profile': { success: true, user: { username: 'anna' } } });
  try {
    await sicht(w, 'profile');
    assert.deepEqual(
      [...d.querySelectorAll('.ntab[aria-current], .ntab.group-active, .ntab.active')].map(x => x.dataset.tab),
      [],
    );
    assert.equal(d.getElementById('header-view').hidden, false);
    assert.equal(text(d.getElementById('header-view')), 'Konto');
    assert.match(d.title, /^Konto – /);
    await reiter(w, 'finance');
    assert.equal(d.getElementById('header-view').hidden, true, 'Name bleibt nach dem Reiterwechsel stehen');
    assert.equal(d.querySelector('.ntab[aria-current="page"]')?.dataset.tab, 'finance');
    assert.match(d.title, /^Finanzen – /);
  } finally {
    w.close();
  }
});

test('import as one menu', async () => {
  const { w, d } = await openUi({});
  try {
    for (const tab of ['gallery', 'parts', 'minifigs']) {
      const leiste = d.querySelector(`#tab-${tab} .capture-bar`);
      assert.deepEqual(
        [...leiste.children].map(e => e.tagName + '.' + e.className.replace(' button-floating', '')),
        ['BUTTON.btn bp', 'DETAILS.import-menu'],
        tab,
      );
      const menue = leiste.querySelector('details');
      // Plus in the set menu "last import" (UI review 17 M4), hidden as long as there is none.
      assert.equal(menue.querySelectorAll('.import-toggle > :not([hidden])').length, 3, `${tab}: drei Importwege`);
      menue.open = true;
      d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert.equal(menue.open, false, `${tab}: Escape schliesst das Menü`);
    }
  } finally {
    w.close();
  }
});

test('theme complete', async () => {
  const { w, d } = await openUi(SETS);
  try {
    await warte(() => d.querySelector('#gallery .smeta-text'));
    const thema = d.querySelector('[data-arg="10300-1"] .smeta-text');
    assert.match(text(thema), /Icons \/ Modular Buildings Collection$/);
    assert.equal(thema.getAttribute('title'), 'Icons / Modular Buildings Collection');
  } finally {
    w.close();
  }
});

const moments = ['2026-08-01', '2026-09-01', '2026-10-01', '2026-10-29'];
const HISTORY = {
  success: true,
  currency: 'EUR',
  period_change_pct: 5,
  data_points: 4,
  points: [1700, 1750, 1720, 1850].map((value, i) => ({ x_label: moments[i], value })),
  chart: { values: [{ values: moments.map(x => ({ x })) }] },
};

test('value chart: currency, cost basis, axis break, crosshair via keyboard', async () => {
  const { w, d } = await openUi({
    ...SETS,
    '/v2/finance/portfolio-history': HISTORY,
    '/v2/finance/pnl': { ...SETS['/v2/finance/pnl'], totals: { grand_total: '1850', purchase: '1568.98' } },
  });
  try {
    await reiter(w, 'finance');
    await warte(() => d.querySelector('#portfolio-chart svg'));
    const svg = d.querySelector('#portfolio-chart svg');
    const achse = [...svg.querySelectorAll('text[text-anchor="end"]')].filter(t => +t.getAttribute('x') < 90).map(text);
    assert.ok(achse.length >= 3 && achse.every(t => /€|EUR/.test(t)), `Achse: ${achse.join(' | ')}`);
    assert.match(zahl(text(svg.querySelector('.cost-basis-line'))), /^Kaufpreisgesamt(EUR)?1568\.98(€)?$/);
    assert.equal(svg.querySelector('.cost-basis-line line').getAttribute('stroke-dasharray'), '6 4');
    assert.ok(svg.querySelector('.axis-break'), 'die Achse beginnt nicht bei 0 und zeigt das nicht');
    assert.match(svg.getAttribute('aria-label'), /beginnt bei \D*1\D?500[.,]00/);
    svg.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    const fk = svg.querySelector('.crosshair');
    assert.equal(fk.getAttribute('visibility'), 'visible');
    assert.match(zahl(text(fk.querySelector('.fk-text'))), /01\.?10\.?2026.*1720\.00/);
    assert.match(zahl(text(svg.parentElement.querySelector('.chart-announcement'))), /1720\.00/);
  } finally {
    w.close();
  }
});

test('period without history', async () => {
  const { w, d } = await openUi({
    ...SETS,
    '/v2/finance/portfolio-history': { success: true, currency: 'EUR', points: [], data_points: 0 },
  });
  try {
    await reiter(w, 'finance');
    await warte(() => d.querySelector('#portfolio-chart .chart-empty'));
    assert.deepEqual(
      [...d.querySelectorAll('.period-choice .period-btn')].map(b => b.disabled),
      [true, true, true, true],
    );
    w.document.querySelector('.period-choice .period-btn[data-period="week"]').disabled = false;
    w.document.querySelector('.period-choice .period-btn[data-period="week"]').click();
    await takt(50);
    assert.ok(
      d.querySelector('#fin-filter [data-kind=""]').classList.contains('active'),
      'der Chip „Alle“ verlor seine Wahl',
    );
  } finally {
    w.close();
  }
});

test('placeholders per language', async () => {
  for (const [language, erwartet] of [
    ['de', 'z. B. 79,99'],
    ['en', 'e.g. 79.99'],
  ]) {
    const { w, d } = await openUi({}, { language });
    try {
      assert.equal(d.getElementById('add-price').placeholder, erwartet);
    } finally {
      w.close();
    }
  }
});
