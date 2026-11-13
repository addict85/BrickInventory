/**
 * Befunde der UI-Prüfung 6 (03.11.2026), am echten Bündel in jsdom: was die
 * Oberfläche aus Serverantworten und Klicks macht.
 *
 * Gegenproben (03.11.2026 gemessen, je einzeln):
 *   A  `if (await setUnbekannt(num)) return;` in doAddSet entfernt → rot:
 *      „unbekannte Setnummer“ (legt sofort an)
 *   B  Filter auf Kauftage in priceChartSVG entfernt → rot: „Preisverlauf“
 *      (Kurve mit 3 statt 2 Punkten)
 *   C  data-change="speichereWaehrung" am Währungsfeld entfernt → rot:
 *      „Konto: Währung wirkt sofort“
 *   D  Rückgängig im Toast von merkpostenLoeschen entfernt → rot: „Merkposten löschen“
 *   (alle acht gemessen: je genau der genannte Test rot, die übrigen grün)
 *   E  LAND_WAEHRUNG['de-CH'] auf EUR → rot: „Gutscheine: Währung des Ausgabelandes“
 *   F  legeAlarmAn ohne -1-Ergänzung → rot: „Preisalarm in seiner Ansicht“
 *   G  Hinweisspalte der Auftragszeile ohne Fehlerkasten → rot: „Hintergrundarbeiten“
 *   H  fmtDatum in Englisch wieder 2-stellig numerisch → rot: „Datum auf Englisch“
 *   I  (05.11.2026, UI-Prüfung 17 M5) Rückfrage vor dem Währungswechsel aus
 *      speichereWaehrung entfernt → rot: „Konto: Währung wirkt sofort“ (kein
 *      Dialog mit „Marktpreise“)
 *   J  (12.11.2026, UX-Prüfung 19 M3: Zeitplanfelder jetzt in den
 *      Einstellungen) in saveJobTime die Prüfung auf HH:MM entfernt → rot:
 *      „Hintergrundarbeiten“ (aria-invalid fehlt)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, sicht, warte, takt } = require('./helpers/oberflaeche');

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

test('unbekannte Setnummer: erst Rückfrage, dann anlegen', async () => {
  const { w, d, aufrufe } = await oeffneOberflaeche({
    '/v1/catalog/sets/99999-1': {
      $status: 404,
      success: false,
      code: 'set_nicht_im_katalog',
      error: 'Set nicht im Katalog',
    },
  });
  try {
    d.querySelector('button[data-click="oeffneErfassen"][data-arg="set"]').click();
    d.getElementById('add-num').value = '99999';
    d.getElementById('btn-add').click();
    await warte(() => !d.getElementById('add-unbekannt').hidden);
    assert.match(text(d.getElementById('add-unbekannt')), /99999-1 ist im Katalog \(noch\) unbekannt/);
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

test('Preisverlauf: Kaufpreis als Punkt, nicht als Anfang der Kurve', async () => {
  const historie = [
    { recorded_at: '2026-06-01', avg_price: 199.99, is_purchase_price: true },
    { recorded_at: '2026-09-01', avg_price: 186 },
    { recorded_at: '2026-10-01', avg_price: 190 },
  ];
  const { w, d } = await oeffneOberflaeche({
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
    await warte(() => d.querySelector('#set-modal svg.diagramm-preis'), 4000);
    const linie = d.querySelector('#set-modal svg.diagramm-preis polyline');
    assert.equal(linie.getAttribute('points').trim().split(/\s+/).length, 2, 'Kaufpreis in der Marktkurve');
    assert.equal(d.querySelectorAll('#set-modal .kaufpunkt').length, 1);
  } finally {
    w.close();
  }
});

test('Konto: Währung wirkt sofort, Passwort hat seinen eigenen Knopf', async () => {
  const { w, d, aufrufe } = await oeffneOberflaeche({
    '/v1/auth/profile': { success: true, user: { username: 'anna', email: 'anna@example.org', email_verified: true } },
  });
  try {
    await sicht(w, 'profil');
    const feld = d.getElementById('s-cur');
    feld.value = 'CHF';
    feld.dispatchEvent(new w.Event('change', { bubbles: true }));
    // Vor dem Wechsel sagt eine Rückfrage, dass die Marktpreise neu geladen werden.
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

test('Merkposten löschen: Rückgängig legt ihn wieder an', async () => {
  const { w, d, aufrufe } = await oeffneOberflaeche({
    '/v1/wanted': (_u, o) =>
      o.method === 'POST'
        ? { success: true, merkposten: { set_number: '10276-1', condition: 'N', user_id: 1, name: 'Colosseum' } }
        : { success: true, merkposten: [{ set_number: '10276-1', condition: 'N', user_id: 1, name: 'Colosseum' }] },
  });
  try {
    await reiter(w, 'wanted');
    await warte(() => d.querySelector('.mk-zeile .delbtn'));
    d.querySelector('.mk-zeile .delbtn').click();
    await warte(() => [...d.querySelectorAll('#toasts button')].some(b => /Rückgängig/.test(b.textContent)));
    [...d.querySelectorAll('#toasts button')].find(b => /Rückgängig/.test(b.textContent)).click();
    await warte(() => aufrufe.some(a => a.method === 'POST' && a.url.endsWith('/v1/wanted')));
    const neu = aufrufe.find(a => a.method === 'POST' && a.url.endsWith('/v1/wanted'));
    assert.deepEqual(JSON.parse(neu.body), { set_number: '10276-1', condition: 'N', owner_user_id: 1 });
  } finally {
    w.close();
  }
});

test('Gutscheine: Währung des Ausgabelandes, Abweichung benannt', async () => {
  const { w, d } = await oeffneOberflaeche({
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
    await sicht(w, 'gutscheine');
    await warte(() => d.querySelector('.voucher-row'));
    assert.equal(d.getElementById('v-currency').value, 'CHF');
    assert.match(text(d.querySelector('.voucher-abweichung')), /nicht CHF wie das Ausgabeland/);
    assert.match(text(d.getElementById('gutschein-land-waehrung')), /CHF/);
  } finally {
    w.close();
  }
});

test('Preisalarm in seiner Ansicht anlegen', async () => {
  const { w, d, aufrufe } = await oeffneOberflaeche({ '/v1/alerts': { success: true, alerts: [] } });
  try {
    await sicht(w, 'alarme');
    d.getElementById('alarm-neu-set').value = '10294';
    d.getElementById('alarm-neu-preis').value = '599,90';
    d.getElementById('alarm-neu-knopf').click();
    await warte(() => aufrufe.some(a => a.method === 'PUT' && a.url.includes('/alert')));
    const ruf = aufrufe.find(a => a.method === 'PUT' && a.url.includes('/alert'));
    assert.match(ruf.url, /\/v1\/sets\/10294-1\/alert$/);
    assert.deepEqual(JSON.parse(ruf.body), { richtung: 'unter', schwelle: 599.9, condition: 'N' });
  } finally {
    w.close();
  }
});

test('Hintergrundarbeiten: beschriftete Spalten, Fehler in der Zeile, Uhrzeit in 24 h', async () => {
  const { w, d, aufrufe } = await oeffneOberflaeche({
    '/v1/admin/job-status': { success: true, job: { running: false } },
    '/v1/admin/jobs': {
      success: true,
      jobs: { csvImport: { status: 'done', label: 'CSV' } },
      schedules: { csvImport: { type: 'daily', time: '03:00' } },
      db: { csvCache: { parts: 5 }, blMapping: {} },
    },
    '/v1/admin/auftraege': {
      success: true,
      zusammenfassung: [{ art: 'wechselkurse', status: 'fehler', anzahl: 1 }],
      job_prozess: { laeuft: true },
      pausen: [],
      bildbedarf: 0,
      auftraege: [
        { id: '9', art: 'wechselkurse', status: 'fehler', fehler: 'ENOTFOUND ecb', versuche: 6, max_versuche: 6 },
      ],
    },
  });
  try {
    await reiter(w, 'monitor');
    await warte(() => d.querySelector('#auftraege-karte table') && d.querySelector('#monitor-content table'));
    const koepfe = [...d.querySelectorAll('#auftraege-karte .mon-arten th')].map(text);
    assert.deepEqual(koepfe, ['Art', 'Offen', 'Läuft', 'Fehlgeschlagen', 'Nächster Lauf', 'Aktionen']);
    assert.ok(d.querySelector('#auftraege-karte tbody tr .fehler-kasten'), 'Fehler nicht in der Zeile seines Auftrags');
    assert.equal(d.querySelectorAll('#tab-monitor h1, #tab-monitor h2').length, 5);
    assert.match(text(d.querySelector('#monitor-content .mon-plan')), /03:00/);
    await reiter(w, 'settings');
    await warte(() => d.querySelector('#einst-zeitplaene input.mon-zeit'));
    const zeit = d.querySelector('#einst-zeitplaene input.mon-zeit');
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

test('Datum auf Englisch mit Monatsnamen', async () => {
  const { w, d } = await oeffneOberflaeche(
    { '/v1/sets': { success: true, sets: [SET], total: 1, themes: [] } },
    { sprache: 'en' },
  );
  try {
    await warte(() => d.querySelector('#gallery .kachel-datum'));
    assert.match(text(d.querySelector('#gallery .kachel-datum')), /\b(1 Jun 2026|Jun 1, 2026)\b/);
  } finally {
    w.close();
  }
});
