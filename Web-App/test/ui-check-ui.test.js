/**
 * Findings of the UI check of 01.11.2026, on the real bundle in jsdom: what the
 * UI makes of a server response (label, feedback,
 * state of the toggles), not which line stands in the source text.
 *
 * Counter-checks (measured 01.11.2026, each reverted individually):
 *   A  groupNumber without removing the separators → red „Gutscheinnummer“
 *   B  role="alert" removed on #lerr → red „Anmeldefehler“
 *   C  aria-pressed not updated in setChartPeriod → red „Zeitraum“
 *   D  ps-total again only total_parts → red „Teile-Zahl“
 *   E  priceRow without a label (art = '') → red „Preis auf der Kachel“
 *   F  diagrammNichtDa removed in the error branch of loadFinance → red „offline“
 *   G  parts empty state again „Keine Teile gefunden“ without a button → red „Teile-Suche ohne Treffer“
 *   H  errorBox again as raw text → red „Hintergrundarbeiten“
 *
 * Counter-checks (measured 13.11.2026):
 *   I  in monitor.js zeile() `wartet` fixed false → red „verschobener Auftrag wartet“
 *      (error box and „Versuch 3 von 5“ in the row)
 *   J  the error box again for every status except 'laeuft' → red: the same
 *      test (error box for the aborted one)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, switchTab, view, waitFor, tick } = require('./helpers/ui');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();

const SET = {
  set_number: '21318-1',
  name: '',
  theme: 'Ideas',
  year: 2019,
  quantity: 1,
  conditions: ['N'],
  avg_purchase_price: 199.99,
  last_purchase: '2026-06-01T10:00:00Z',
  added_at: '2026-11-01T10:00:00Z',
  instructions: [],
};

test('voucher number: separators off first, then groups of four; without a PDF it is in the text', async () => {
  const { w, d } = await openUi({
    '/v2/vouchers': {
      success: true,
      vouchers: [{ id: 1, number: '6123-4567-8901', pin: '4711', amount: 50, currency: 'EUR', has_pdf: false }],
    },
  });
  try {
    await view(w, 'vouchers');
    await waitFor(() => d.querySelector('.voucher-num'));
    assert.equal(text(d.querySelector('.voucher-num')), '6123 4567 8901');
    assert.equal(text(d.querySelector('.voucher-nopdf')), 'kein Original');
  } finally {
    w.close();
  }
});

test('login error is read aloud (role=alert) and stays', async () => {
  const { w, d } = await openUi(
    {
      '/v2/auth/login': {
        $status: 401,
        success: false,
        error: 'Benutzername oder Passwort falsch',
        code: 'credentials_invalid',
      },
    },
    { loggedIn: false },
  );
  try {
    await waitFor(() => typeof d.getElementById('btn-login')?.onclick === 'function');
    d.getElementById('lu').value = 'anna';
    d.getElementById('lp').value = 'wrong';
    d.getElementById('btn-login').click();
    await waitFor(() => text(d.getElementById('lerr')));
    assert.equal(d.getElementById('lerr').getAttribute('role'), 'alert');
    assert.equal(text(d.getElementById('lerr')), 'Benutzername oder Passwort falsch');
  } finally {
    w.close();
  }
});

test('period and filter of the finances report their state (aria-pressed)', async () => {
  // Two measurement points: without history the period buttons are locked.
  const { w, d } = await openUi({
    '/v2/finance/portfolio-history': {
      success: true,
      data_points: 2,
      points: [
        { x_label: '1.10.', value: 100 },
        { x_label: '1.11.', value: 110 },
      ],
    },
  });
  try {
    await switchTab(w, 'finance');
    await waitFor(() => !d.querySelector('.period-choice [data-period="week"]').disabled);
    const button = sel => d.querySelector(sel);
    button('.period-choice [data-period="week"]').click();
    await tick(20);
    assert.deepEqual(
      [...d.querySelectorAll('.period-choice .period-btn')].map(
        b => `${b.dataset.period}:${b.getAttribute('aria-pressed')}`,
      ),
      ['week:true', 'month:false', 'year:false', 'max:false'],
    );
    button('#fin-filter [data-kind="sets"]').click();
    await tick(20);
    assert.deepEqual(
      [...d.querySelectorAll('#fin-filter button')].map(b => b.getAttribute('aria-pressed')),
      ['false', 'true', 'false', 'false'],
    );
    await switchTab(w, 'parts');
    assert.deepEqual(
      [...d.querySelectorAll('#tab-parts .collection-choice button')].map(b => b.getAttribute('aria-current')),
      [null, 'page', null],
    );
  } finally {
    w.close();
  }
});

test('part count: collection and parts tab show the same sum with breakdown', async () => {
  const { w, d } = await openUi({
    '/v2/stats': {
      success: true,
      stats: {
        total_sets: 4,
        total_parts: 394,
        set_parts: 144,
        manual_parts: 250,
        total_minifigs: 3,
        total_instructions: 0,
      },
    },
    '/v2/parts/stats': {
      success: true,
      stats: { total_parts: 144, manual_parts: 250, unique_parts: 3, unique_colors: 4 },
    },
  });
  try {
    await waitFor(() => text(d.getElementById('bstat-parts')) === '394');
    assert.equal(text(d.getElementById('bstat-parts-sub')), '144 aus Sets · 250 einzeln');
    await switchTab(w, 'parts');
    await waitFor(() => text(d.getElementById('ps-total')) !== '—');
    assert.equal(text(d.getElementById('ps-total')), '394');
    assert.equal(text(d.getElementById('ps-total-sub')), '144 aus Sets · 250 einzeln');
  } finally {
    w.close();
  }
});

test('price on the tile is labeled, condition and date named (de and en)', async () => {
  for (const [language, kind, condition, bought, unknownOne] of [
    ['de', 'Kaufpreis', 'Neuware', 'Gekauft', 'Unbekannt'],
    ['en', 'Purchase price', 'New', 'Bought', 'Unknown'],
  ]) {
    const { w, d } = await openUi(
      { '/v2/sets': { success: true, sets: [SET], total: 1, themes: ['Ideas'] } },
      { language },
    );
    try {
      await waitFor(() => d.querySelector('#gallery .sc'));
      const tile = d.querySelector('#gallery .sc');
      assert.equal(text(tile.querySelector('.price-badge .price-kind')), kind);
      assert.match(text(tile.querySelector('.cond-new')), new RegExp(`: ${condition}$`));
      assert.match(text(tile.querySelector('.tile-date')), new RegExp(`^${bought} `));
      assert.equal(text(tile.querySelector('.sname')), unknownOne);
    } finally {
      w.close();
    }
  }
});

test('offline: the chart says “not available” with reason and button instead of “Loading…”', async () => {
  const networkPath = () => {
    throw new TypeError('Failed to fetch');
  };
  const { w, d } = await openUi({
    '/v2/finance/valuation': networkPath,
    '/v2/finance/portfolio-history': networkPath,
  });
  try {
    await switchTab(w, 'finance');
    // Reason and button stand once, since UX check 24 (M2) at the top of the chart box; the list below stays empty.
    await waitFor(() => /nicht erreichbar/.test(text(d.getElementById('portfolio-chart'))));
    assert.match(text(d.getElementById('portfolio-chart')), /Keine Verbindung zum Server.*Erneut versuchen/);
    assert.equal(text(d.getElementById('fin-tbl')), '');
    assert.equal(
      d.querySelectorAll('#tab-finance [data-click="loadFinance"], #tab-finance [data-click="loadPortfolioChart"]')
        .length,
      1,
    );
  } finally {
    w.close();
  }
});

// UX check 24 (M2): without a loaded state the cards drop away instead of showing „—“ without error reference; the
// period buttons are locked. Counter-check (14.11.2026): `hidden = true` removed in finanzenFehlen() → red
// (cards visible); the locking of the buttons removed → red (period operable).
test('offline: the key figure cards of the finances drop, the period buttons are locked', async () => {
  const networkPath = () => {
    throw new TypeError('Failed to fetch');
  };
  {
    const { w, d } = await openUi({
      '/v2/finance/valuation': networkPath,
      '/v2/finance/portfolio-history': networkPath,
    });
    try {
      await switchTab(w, 'finance');
      await waitFor(() => /nicht erreichbar/.test(text(d.getElementById('portfolio-chart'))));
      assert.equal(d.getElementById('fin-sum').hidden, true, 'cards without a number visible');
      assert.equal(text(d.getElementById('portfolio-current')), '—');
      assert.deepEqual(
        [...d.querySelectorAll('.period-choice .period-btn')].map(k => k.disabled),
        [true, true, true, true],
        'period operable',
      );
    } finally {
      w.close();
    }
  }
  const { w, d } = await openUi({
    '/v2/finance/valuation': { $status: 500, success: false, error: 'kaputt', code: 'intern' },
  });
  try {
    await switchTab(w, 'finance');
    await waitFor(() => d.getElementById('fin-sum').hidden === true);
    assert.match(text(d.getElementById('portfolio-chart')), /Erneut versuchen/);
  } finally {
    w.close();
  }
});

test('parts search without results: “No results for …” with a button that clears the search', async () => {
  const { w, d } = await openUi({});
  try {
    await switchTab(w, 'parts');
    const field = d.getElementById('parts-search');
    field.value = 'xyz';
    field.dispatchEvent(new w.Event('input', { bubbles: true }));
    await waitFor(() => /xyz/.test(text(d.querySelector('#tab-parts .empty-state'))), 3000);
    assert.equal(text(d.querySelector('#tab-parts .empty-state h2')), 'Keine Treffer für „xyz“');
    d.querySelector('#tab-parts .empty-state [data-click="resetFilter"]').click();
    await waitFor(() => text(d.querySelector('#tab-parts .empty-state h2')) === 'Noch keine Teile', 3000);
    assert.equal(field.value, '');
  } finally {
    w.close();
  }
});

test('background jobs: technical error as a sentence, details expandable', async () => {
  const raw = 'getaddrinfo ENOTFOUND rebrickable.com';
  const { w, d } = await openUi({
    '/v2/admin/job-status': { success: true, job: { running: false } },
    '/v2/admin/jobs': { success: true, jobs: {}, schedules: {}, db: { csvCache: {}, blMapping: {} } },
    '/v2/admin/job-queue': {
      success: true,
      summary: [{ type: 'instructions', status: 'error', count: 1 }],
      job_process: { running: true },
      pauses: [],
      image_demand: 0,
      jobs: [
        {
          id: '7',
          type: 'instructions',
          status: 'error',
          set_number: '10294-1',
          error_message: raw,
          attempts: 3,
          max_attempts: 3,
        },
      ],
    },
  });
  try {
    await switchTab(w, 'monitor');
    await waitFor(() => d.querySelector('#jobs-card .error-box'), 3000);
    const box = d.querySelector('#jobs-card .error-box');
    assert.equal(text(box.querySelector('summary')), 'Dienst nicht erreichbar — Netz oder Server gestört.');
    assert.equal(text(box.querySelector('code')), raw);
  } finally {
    w.close();
  }
});

test('background jobs: a postponed job waits, an aborted one has not failed', async () => {
  const until = new Date(Date.now() + 3 * 3600_000).toISOString();
  const row = (id, more) => ({
    id,
    type: 'price_refresh',
    set_number: null,
    attempts: 3,
    max_attempts: 5,
    due_at: until,
    scheduled: false,
    waiting: false,
    progress: null,
    ...more,
  });
  const { w, d } = await openUi({
    '/v2/admin/job-status': { success: true, job: { running: false } },
    '/v2/admin/jobs': { success: true, jobs: {}, schedules: {}, db: { csvCache: {}, blMapping: {} } },
    '/v2/admin/job-queue': {
      success: true,
      summary: [{ type: 'price_refresh', status: 'pending', count: 2 }],
      job_process: { running: true },
      pauses: [],
      image_demand: 0,
      jobs: [
        row('1', { status: 'pending', waiting: true, error_message: 'BrickLink-Tageskontingent erschöpft' }),
        row('2', { status: 'pending', error_message: 'getaddrinfo ENOTFOUND api.bricklink.com' }),
        row('3', { status: 'cancelled', error_message: 'cancelled', due_at: null }),
      ],
    },
  });
  try {
    await switchTab(w, 'monitor');
    await waitFor(() => d.querySelectorAll('#jobs-card .mon-single tbody tr').length === 3, 3000);
    const [waiting, again, ab] = [...d.querySelectorAll('#jobs-card .mon-single tbody tr')];
    assert.equal(waiting.querySelector('.error-box'), null, `shown as an error: ${text(waiting)}`);
    assert.match(text(waiting), /wartet bis .*\d{1,2}:\d{2}.*BrickLink-Tageskontingent erschöpft/);
    assert.doesNotMatch(text(waiting), /Versuch/);
    assert.ok(again.querySelector('.error-box'), 'an error before the next attempt stays visible');
    assert.equal(ab.querySelector('.error-box'), null, `aborted shown as an error: ${text(ab)}`);
    assert.equal(d.querySelector('[data-click="retryJob"]'), null);
  } finally {
    w.close();
  }
});
