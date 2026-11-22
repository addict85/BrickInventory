/**
 * Findings of UI check 6 (03.11.2026), on the real bundle in jsdom: what the
 * UI makes of server responses and clicks.
 *
 * Counter-checks (measured 03.11.2026, each on its own):
 *   A  `if (await setUnbekannt(num)) return;` removed in doAddSet → red:
 *      “unknown set number” (creates immediately)
 *   B  filter on purchase days removed in priceChartSVG → red: “price history”
 *      (curve with 3 instead of 2 points)
 *   C  data-change="saveCurrency" removed on the currency field → red:
 *      “account: currency applies immediately”
 *   D  undo removed in the toast of deleteWantedItem → red: “delete pending item”
 *   (all eight measured: each exactly the named test red, the others green)
 *   E  COUNTRY_CURRENCY['de-CH'] set to EUR → red: “vouchers: currency of the issuing country”
 *   F  createAlert without the -1 addition → red: “create price alert in its view”
 *   G  hint column of the job row without the error box → red: “background jobs”
 *   H  fmtDate in English again 2-digit numeric → red: “date in English”
 *   I  (05.11.2026, UI check 17 M5) prompt before the currency change removed from
 *      saveCurrency → red: “account: currency applies immediately” (no
 *      dialog with „Marktpreise“)
 *   J  (12.11.2026, UX check 19 M3: schedule fields now in the
 *      settings) the check for HH:MM removed in saveJobTime → red:
 *      “background jobs” (aria-invalid missing)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, sicht, warte, takt } = require('./helpers/ui');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const SET = {
  set_number: '21318-1',
  name: 'Tree House',
  theme: 'Ideas',
  year: 2019,
  quantity: 1,
  conditions: ['N'],
  avg_purchase_price: 199.99,
  letzter_kauf: '2026-06-01T10:00:00Z',
  added_at: '2026-11-01T10:00:00Z',
  instructions: [],
};

test('unknown set number: ask first, then create', async () => {
  const { w, d, aufrufe } = await openUi({
    '/v1/catalog/sets/99999-1': {
      $status: 404,
      success: false,
      code: 'set_nicht_im_katalog',
      error: 'Set nicht im Katalog',
    },
  });
  try {
    d.querySelector('button[data-click="openCapture"][data-arg="set"]').click();
    d.getElementById('add-num').value = '99999';
    d.getElementById('btn-add').click();
    await warte(() => !d.getElementById('add-unknown').hidden);
    assert.match(text(d.getElementById('add-unknown')), /99999-1 ist im Katalog \(noch\) unbekannt/);
    assert.equal(text(d.getElementById('btn-add')), 'Trotzdem anlegen');
    assert.equal(
      aufrufe.some(a => a.url.includes('add-stream')),
      false,
      'ohne Rückfrage angelegt',
    );
    d.getElementById('btn-add').click();
    await warte(() => aufrufe.some(a => a.url.includes('add-stream')));
    assert.ok(
      aufrufe.some(a => a.url.includes('add-stream')),
      'nach der Bestätigung nicht angelegt',
    );
  } finally {
    w.close();
  }
});

test('price history: purchase price as a point, not as the start of the curve', async () => {
  const historie = [
    { recorded_at: '2026-06-01', avg_price: 199.99, is_purchase_price: true },
    { recorded_at: '2026-09-01', avg_price: 186 },
    { recorded_at: '2026-10-01', avg_price: 190 },
  ];
  const { w, d } = await openUi({
    '/v1/sets': { success: true, sets: [SET], total: 1, themes: [] },
    '/v1/sets/21318-1': { success: true, set: SET },
    '/v1/sets/21318-1/price-history': {
      success: true,
      currency: 'EUR',
      history_new: historie,
      history_used: [],
      by_condition: { N: { purchase_price: 199.99, market_price: 190 } },
      chart: {
        x: historie.map(h => h.recorded_at),
        values: [{ name: 'N', firstRealIndex: 0, values: historie.map(h => ({ x: h.recorded_at, y: h.avg_price })) }],
      },
    },
  });
  try {
    await warte(() => d.querySelector('#gallery [data-click="openModal"]'));
    d.querySelector('#gallery [data-click="openModal"]').click();
    await warte(() => d.querySelector('#set-modal svg.chart-price'), 4000);
    const linie = d.querySelector('#set-modal svg.chart-price polyline');
    assert.equal(linie.getAttribute('points').trim().split(/\s+/).length, 2, 'Kaufpreis in der Marktkurve');
    assert.equal(d.querySelectorAll('#set-modal .purchase-dot').length, 1);
  } finally {
    w.close();
  }
});

test('account: currency applies immediately, password has its own button', async () => {
  const { w, d, aufrufe } = await openUi({
    '/v1/auth/profile': { success: true, user: { username: 'anna', email: 'anna@example.org', email_verified: true } },
  });
  try {
    await sicht(w, 'profile');
    const feld = d.getElementById('s-cur');
    feld.value = 'CHF';
    feld.dispatchEvent(new w.Event('change', { bubbles: true }));
    // Before the change a prompt says that the market prices are reloaded.
    assert.ok(
      await warte(() => d.getElementById('confirm-modal').style.display === 'flex'),
      'Rückfrage vor dem Währungswechsel',
    );
    assert.match(d.getElementById('cd-msg').textContent, /Marktpreise/);
    d.getElementById('cd-confirm').click();
    await warte(() => aufrufe.some(a => a.method === 'POST' && a.url.endsWith('/v1/settings') && /CHF/.test(a.body)));
    await warte(() => d.getElementById('confirm-modal').style.display !== 'flex');
    assert.ok(
      aufrufe.some(a => a.method === 'POST' && a.url.endsWith('/v1/settings') && JSON.parse(a.body).currency === 'CHF'),
    );
    d.getElementById('pw-n').value = d.getElementById('pw-r').value = 'neu-Passwort-1';
    d.getElementById('btn-sav-pw').click();
    await warte(() => d.getElementById('confirm-modal').style.display === 'flex');
    d.getElementById('cd-pw').value = 'alt-Passwort-1';
    d.getElementById('cd-confirm').click();
    await warte(() => aufrufe.some(a => a.url.endsWith('/v1/auth/change-password')));
    assert.equal(
      aufrufe.some(a => a.url.endsWith('/v1/auth/profile') && a.method === 'PUT'),
      false,
      'Passwort speichert das Profil mit',
    );
  } finally {
    w.close();
  }
});

test('delete pending item: undo creates it again', async () => {
  const { w, d, aufrufe } = await openUi({
    '/v1/wanted': (_u, o) =>
      o.method === 'POST'
        ? { success: true, merkposten: { set_number: '10276-1', condition: 'N', user_id: 1, name: 'Colosseum' } }
        : { success: true, merkposten: [{ set_number: '10276-1', condition: 'N', user_id: 1, name: 'Colosseum' }] },
  });
  try {
    await reiter(w, 'wanted');
    await warte(() => d.querySelector('.mk-row .delbtn'));
    d.querySelector('.mk-row .delbtn').click();
    await warte(() => [...d.querySelectorAll('#toasts button')].some(b => /Rückgängig/.test(b.textContent)));
    [...d.querySelectorAll('#toasts button')].find(b => /Rückgängig/.test(b.textContent)).click();
    await warte(() => aufrufe.some(a => a.method === 'POST' && a.url.endsWith('/v1/wanted')));
    const neu = aufrufe.find(a => a.method === 'POST' && a.url.endsWith('/v1/wanted'));
    assert.deepEqual(JSON.parse(neu.body), { set_number: '10276-1', condition: 'N', owner_user_id: 1 });
  } finally {
    w.close();
  }
});

test('vouchers: currency of the issuing country, deviation named', async () => {
  const { w, d } = await openUi({
    '/v1/settings/raw': {
      success: true,
      settings: { currency: 'EUR', language: 'de', rebrickable_api_key: 'probe', gutschein_land: 'de-CH' },
    },
    '/v1/vouchers': {
      success: true,
      vouchers: [{ id: 3, number: '6123456789012', pin: '', amount: 50, currency: 'EUR', hat_pdf: false }],
    },
  });
  try {
    await sicht(w, 'vouchers');
    await warte(() => d.querySelector('.voucher-row'));
    assert.equal(d.getElementById('v-currency').value, 'CHF');
    assert.match(text(d.querySelector('.voucher-deviation')), /nicht CHF wie das Ausgabeland/);
    assert.match(text(d.getElementById('voucher-country-currency')), /CHF/);
  } finally {
    w.close();
  }
});

test('create price alert in its view', async () => {
  const { w, d, aufrufe } = await openUi({ '/v1/alerts': { success: true, alerts: [] } });
  try {
    await sicht(w, 'alerts');
    d.getElementById('alert-new-set').value = '10294';
    d.getElementById('alert-new-price').value = '599,90';
    d.getElementById('alert-new-button').click();
    await warte(() => aufrufe.some(a => a.method === 'PUT' && a.url.includes('/alert')));
    const ruf = aufrufe.find(a => a.method === 'PUT' && a.url.includes('/alert'));
    assert.match(ruf.url, /\/v1\/sets\/10294-1\/alert$/);
    assert.deepEqual(JSON.parse(ruf.body), { direction: 'unter', threshold: 599.9, condition: 'N' });
  } finally {
    w.close();
  }
});

test('background jobs: labeled columns, error in the row, time in 24 h', async () => {
  const { w, d, aufrufe } = await openUi({
    '/v1/admin/job-status': { success: true, job: { running: false } },
    '/v1/admin/jobs': {
      success: true,
      jobs: { csvImport: { status: 'done', label: 'CSV' } },
      schedules: { csvImport: { type: 'daily', time: '03:00' } },
      db: { csvCache: { parts: 5 }, blMapping: {} },
    },
    '/v1/admin/auftraege': {
      success: true,
      zusammenfassung: [{ type: 'wechselkurse', status: 'fehler', anzahl: 1 }],
      job_prozess: { laeuft: true },
      pausen: [],
      bildbedarf: 0,
      auftraege: [
        {
          id: '9',
          type: 'wechselkurse',
          status: 'fehler',
          error_message: 'ENOTFOUND ecb',
          attempts: 6,
          max_attempts: 6,
        },
      ],
    },
  });
  try {
    await reiter(w, 'monitor');
    await warte(() => d.querySelector('#jobs-card table') && d.querySelector('#monitor-content table'));
    const headers = [...d.querySelectorAll('#jobs-card .mon-kinds th')].map(text);
    assert.deepEqual(headers, ['Art', 'Offen', 'Läuft', 'Aufgegeben', 'Nächster Lauf', 'Aktionen']);
    assert.ok(d.querySelector('#jobs-card tbody tr .error-box'), 'Fehler nicht in der Zeile seines Auftrags');
    assert.equal(d.querySelectorAll('#tab-monitor h1, #tab-monitor h2').length, 5);
    assert.match(text(d.querySelector('#monitor-content .mon-plan')), /03:00/);
    await reiter(w, 'settings');
    await warte(() => d.querySelector('#settings-schedules input.mon-time'));
    const zeit = d.querySelector('#settings-schedules input.mon-time');
    assert.equal(zeit.type, 'text');
    zeit.value = '3:5';
    zeit.dispatchEvent(new w.Event('change', { bubbles: true }));
    await takt(30);
    assert.equal(zeit.getAttribute('aria-invalid'), 'true');
    zeit.value = '4:30';
    zeit.dispatchEvent(new w.Event('change', { bubbles: true }));
    await warte(() => aufrufe.some(a => a.url.endsWith('/v1/admin/job-schedule')));
    assert.equal(JSON.parse(aufrufe.find(a => a.url.endsWith('/v1/admin/job-schedule')).body).time, '04:30');
  } finally {
    w.close();
  }
});

test('date in English with month names', async () => {
  const { w, d } = await openUi(
    { '/v1/sets': { success: true, sets: [SET], total: 1, themes: [] } },
    { sprache: 'en' },
  );
  try {
    await warte(() => d.querySelector('#gallery .tile-date'));
    assert.match(text(d.querySelector('#gallery .tile-date')), /\b(1 Jun 2026|Jun 1, 2026)\b/);
  } finally {
    w.close();
  }
});
