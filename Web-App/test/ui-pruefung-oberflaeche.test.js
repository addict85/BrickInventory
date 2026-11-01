/**
 * Befunde der UI-Prüfung vom 01.11.2026, am echten Bündel in jsdom: was die
 * Oberfläche aus einer Serverantwort macht (Beschriftung, Rückmeldung,
 * Zustand der Umschalter), nicht welche Zeile im Quelltext steht.
 *
 * Gegenproben (01.11.2026 gemessen, je einzeln zurückgedreht):
 *   A  gruppiereNummer ohne das Entfernen der Trenner → rot „Gutscheinnummer“
 *   B  role="alert" an #lerr entfernt → rot „Anmeldefehler“
 *   C  aria-pressed in setChartPeriod nicht nachgezogen → rot „Zeitraum“
 *   D  ps-total wieder nur total_parts → rot „Teile-Zahl“
 *   E  preisZeile ohne Beschriftung (art = '') → rot „Preis auf der Kachel“
 *   F  diagrammNichtDa im Fehlerzweig von loadFinance entfernt → rot „offline“
 *   G  Teile-Leerzustand wieder „Keine Teile gefunden“ ohne Knopf → rot „Teile-Suche ohne Treffer“
 *   H  fehlerKasten wieder als roher Text → rot „Hintergrundarbeiten“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, sicht, warte, takt } = require('./helpers/oberflaeche');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();

const SET = { set_number: '21318-1', name: '', theme: 'Ideas', year: 2019, quantity: 1, conditions: ['N'],
  avg_purchase_price: 199.99, letzter_kauf: '2026-06-01T10:00:00Z', added_at: '2026-11-01T10:00:00Z', instructions: [] };

test('Gutscheinnummer: erst Trenner weg, dann Vierergruppen; ohne PDF steht es im Text', async () => {
  const { w, d } = await oeffneOberflaeche({ '/v1/vouchers': { success: true, vouchers: [
    { id: 1, number: '6123-4567-8901', pin: '4711', amount: 50, currency: 'EUR', hat_pdf: false }] } });
  try {
    await sicht(w, 'gutscheine');
    await warte(() => d.querySelector('.voucher-num'));
    assert.equal(text(d.querySelector('.voucher-num')), '6123 4567 8901');
    assert.equal(text(d.querySelector('.voucher-nopdf .vh')), 'Kein PDF hinterlegt');
  } finally { w.close(); }
});

test('Anmeldefehler wird vorgelesen (role=alert) und steht da', async () => {
  const { w, d } = await oeffneOberflaeche({ '/v1/auth/login': { $status: 401, success: false, error: 'Benutzername oder Passwort falsch' } },
    { angemeldet: false });
  try {
    await warte(() => typeof d.getElementById('btn-login')?.onclick === 'function');
    d.getElementById('lu').value = 'anna'; d.getElementById('lp').value = 'falsch';
    d.getElementById('btn-login').click();
    await warte(() => text(d.getElementById('lerr')));
    assert.equal(d.getElementById('lerr').getAttribute('role'), 'alert');
    assert.equal(text(d.getElementById('lerr')), 'Benutzername oder Passwort falsch');
  } finally { w.close(); }
});

test('Zeitraum und Filter der Finanzen melden ihren Zustand (aria-pressed)', async () => {
  // Zwei Messpunkte: Ohne Verlauf sind die Zeitraum-Knöpfe gesperrt.
  const { w, d } = await oeffneOberflaeche({ '/v1/finance/portfolio-history': { success: true, messpunkte: 2,
    points: [{ x_label: '1.10.', value: 100 }, { x_label: '1.11.', value: 110 }] } });
  try {
    await reiter(w, 'finance');
    await warte(() => !d.querySelector('.zeitraum-wahl [data-period="week"]').disabled);
    const knopf = (sel) => d.querySelector(sel);
    knopf('.zeitraum-wahl [data-period="week"]').click();
    await takt(20);
    assert.deepEqual([...d.querySelectorAll('.zeitraum-wahl .period-btn')].map(b => `${b.dataset.period}:${b.getAttribute('aria-pressed')}`),
      ['week:true', 'month:false', 'year:false', 'max:false']);
    knopf('#fin-filter [data-art="sets"]').click();
    await takt(20);
    assert.deepEqual([...d.querySelectorAll('#fin-filter button')].map(b => b.getAttribute('aria-pressed')),
      ['false', 'true', 'false', 'false']);
    await reiter(w, 'parts');
    assert.deepEqual([...d.querySelectorAll('#tab-parts .sammlung-wahl button')].map(b => b.getAttribute('aria-current')),
      [null, 'page', null]);
  } finally { w.close(); }
});

test('Teile-Zahl: Sammlung und Teile-Reiter zeigen dieselbe Summe mit Aufschlüsselung', async () => {
  const { w, d } = await oeffneOberflaeche({
    '/v1/stats': { success: true, stats: { total_sets: 4, total_parts: 394, set_parts: 144, manual_parts: 250, total_minifigs: 3, total_instructions: 0 } },
    '/v1/parts/stats': { success: true, stats: { total_parts: 144, manual_parts: 250, unique_parts: 3, unique_colors: 4 } },
  });
  try {
    await warte(() => text(d.getElementById('bstat-parts')) === '394');
    assert.equal(text(d.getElementById('bstat-parts-sub')), '144 aus Sets · 250 einzeln');
    await reiter(w, 'parts');
    await warte(() => text(d.getElementById('ps-total')) !== '—');
    assert.equal(text(d.getElementById('ps-total')), '394');
    assert.equal(text(d.getElementById('ps-total-sub')), '144 aus Sets · 250 einzeln');
  } finally { w.close(); }
});

test('Preis auf der Kachel ist beschriftet, Zustand und Datum benannt (de und en)', async () => {
  for (const [sprache, art, zustand, gekauft, unbekannt] of [['de', 'Kauf', 'Neuware', 'Gekauft', 'Unbekannt'], ['en', 'Paid', 'New', 'Bought', 'Unknown']]) {
    const { w, d } = await oeffneOberflaeche({ '/v1/sets': { success: true, sets: [SET], total: 1, themes: ['Ideas'] } }, { sprache });
    try {
      await warte(() => d.querySelector('#gallery .sc'));
      const kachel = d.querySelector('#gallery .sc');
      assert.equal(text(kachel.querySelector('.price-badge .preis-art')), art);
      assert.match(text(kachel.querySelector('.cond-new')), new RegExp(`: ${zustand}$`));
      assert.match(text(kachel.querySelector('.kachel-datum')), new RegExp(`^${gekauft} `));
      assert.equal(text(kachel.querySelector('.sname')), unbekannt);
    } finally { w.close(); }
  }
});

test('offline: Das Diagramm sagt „Nicht verfügbar – offline“ statt weiter „Laden…“', async () => {
  const netzweg = () => { throw new TypeError('Failed to fetch'); };
  const { w, d } = await oeffneOberflaeche({ '/v1/finance/valuation': netzweg, '/v1/finance/portfolio-history': netzweg });
  try {
    await reiter(w, 'finance');
    await warte(() => /offline/.test(text(d.getElementById('portfolio-chart'))));
    assert.equal(text(d.getElementById('portfolio-chart')), 'Nicht verfügbar – offline');
  } finally { w.close(); }
});

test('Teile-Suche ohne Treffer: „Keine Treffer für …“ mit Knopf, der die Suche leert', async () => {
  const { w, d } = await oeffneOberflaeche({});
  try {
    await reiter(w, 'parts');
    const feld = d.getElementById('parts-search');
    feld.value = 'xyz';
    feld.dispatchEvent(new w.Event('input', { bubbles: true }));
    await warte(() => /xyz/.test(text(d.querySelector('#tab-parts .leer'))), 3000);
    assert.equal(text(d.querySelector('#tab-parts .leer h3')), 'Keine Treffer für „xyz“');
    d.querySelector('#tab-parts .leer [data-click="filterZuruecksetzen"]').click();
    await warte(() => text(d.querySelector('#tab-parts .leer h3')) === 'Noch keine Teile', 3000);
    assert.equal(feld.value, '');
  } finally { w.close(); }
});

test('Hintergrundarbeiten: technischer Fehler als Satz, Einzelheiten aufklappbar', async () => {
  const roh = 'getaddrinfo ENOTFOUND rebrickable.com';
  const { w, d } = await oeffneOberflaeche({ '/v1/admin/job-status': { success: true, job: { running: false } },
    '/v1/admin/jobs': { success: true, jobs: {}, schedules: {},
    db: { csvCache: {}, blMapping: {} } }, '/v1/admin/auftraege': { success: true, zusammenfassung: [{ art: 'anleitung', status: 'fehler', anzahl: 1 }],
    job_prozess: { laeuft: true }, pausen: [], bildbedarf: 0,
    auftraege: [{ id: 7, art: 'anleitung', status: 'fehler', set_number: '10294-1', fehler: roh, versuche: 3, max_versuche: 3 }] } });
  try {
    await reiter(w, 'monitor');
    await warte(() => d.querySelector('#auftraege-karte .fehler-kasten'), 3000);
    const kasten = d.querySelector('#auftraege-karte .fehler-kasten');
    assert.equal(text(kasten.querySelector('summary')), 'Dienst nicht erreichbar — Netz oder Server gestört.');
    assert.equal(text(kasten.querySelector('code')), roh);
  } finally { w.close(); }
});
