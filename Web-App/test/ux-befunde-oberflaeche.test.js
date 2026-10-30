/**
 * Befunde der UX-Prüfung vom 30.10.2026, am echten Bündel in jsdom:
 *   - Kaufpreis 0: „Geschenk“ statt Prozent in Kachel, Finanztabelle und
 *     Set-Detail; der Kaufpreis steht als „0,00 €“ da.
 *   - Seiten hinter dem Menü: kein Reiter bleibt markiert, der Seitenname
 *     steht im Kopf und im Fenstertitel.
 *   - Importwege als ein Menü neben der Hauptaktion.
 *   - Das Thema der Kachel ist ganz da (Ellipsis per CSS, voller Name im title).
 *   - Wertdiagramm: Währung an der Achse, Einstand-Linie, Achsenbruch,
 *     Fadenkreuz per Tastatur; Zeitraum-Knöpfe ohne Verlauf gesperrt, und
 *     sie lassen die Filterchips in Ruhe.
 *   - Der Preis-Platzhalter folgt der Sprache.
 *   - Ein Set ohne Bild zeigt im Detail denselben Würfel wie in der Kachel.
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  pnlBadge ohne den Geschenk-Zweig → rot: „Geschenk in Kachel, Tabelle
 *      und Detail“ (Kachel zeigte „+163.700,0 %“)
 *   B  in oeffneSicht markiereGruppe(null) entfernt → rot: „Menüseite:
 *      kein Reiter markiert“ (aria-current an „Sammlung“)
 *   C  smeta-text wieder mit substring(0,12) → rot: „Thema ganz“
 *   D  bezugsLinie im Wertdiagramm nicht gezeichnet → rot: „Wertdiagramm“
 *   E  setChartPeriod wieder über alle .period-btn → rot: „Zeitraum ohne
 *      Verlauf“ (der Chip „Alle“ verlor active)
 *   F  de 'gallery.add.price_ph' wieder „79.99“ → rot: „Platzhalter je Sprache“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { oeffneOberflaeche, reiter, sicht, warte, takt } = require('./helpers/oberflaeche');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
// jsdom formatiert je nach Umgebung „1.500 €“ oder „EUR 1’500“; verglichen wird ohne Trenner.
const zahl = s => { const o = s.replace(/[’'\s\u00a0]/g, ''); return /,\d\d/.test(o) ? o.replace(/\./g, '').replace(/,/g, '.') : o; };
const SETS = {
  '/v1/sets': { success: true, total: 2, themes: [], sets: [
    { set_number: '10300-1', name: 'Back to the Future', year: 2022, theme: 'Icons / Modular Buildings Collection', quantity: 1, avg_purchase_price: 0, max_purchase_price: 0 },
    { set_number: '21318-1', name: 'Tree House', year: 2019, theme: 'Ideas', quantity: 1, avg_purchase_price: 199.99, max_purchase_price: 199.99 } ] },
  '/v1/finance/pnl': { success: true, currency: 'EUR', totals: { grand_total: '350', purchase: '199.99' }, sets: [
    // Der Server schickt bei Kaufpreis 0 kein Prozent mehr; die Kachel darf es auch nicht zeigen, wenn doch.
    { set_number: '10300-1', kachel_preis: 163.8, kachel_pnl_pct: 1637000 },
    { set_number: '21318-1', kachel_preis: 186.2, kachel_pnl_pct: -6.9 } ] },
  '/v1/finance/valuation': { success: true, currency: 'EUR', totals: { min: '0', avg: '350', max: '0' }, sets: [
    { set_number: '10300-1', name: 'Back to the Future', quantity: 1, purchase_price: 0, avg_price: 163.8, wert_gesamt: 163.8, pnl_prozent: null,
      acquisitions: [{ id: 1, condition: 'N', quantity: 1, purchase_price: 0, avg_price: 163.8, wert_gesamt: 163.8, pnl_prozent: null }] } ] },
  '/v1/sets/10300-1': { success: true, set: { set_number: '10300-1', name: 'Back to the Future', year: 2022, quantity: 1 } },
  '/v1/sets/10300-1/acquisitions': { success: true, acquisitions: [{ id: 1, condition: 'N', quantity: 1, purchase_price: 0, created_at: '2026-06-01T10:00:00Z' }] },
  '/v1/sets/10300-1/price-history': { success: true, by_condition: { N: { market_price: 163.8, purchase_price: 0, pnl_pct: null } } },
};

test('Geschenk in Kachel, Tabelle und Detail', async () => {
  const { w, d } = await oeffneOberflaeche(SETS);
  try {
    await warte(() => /Geschenk|%/.test(text(d.querySelector('[data-price-for="10300-1"]'))));
    const kachel = text(d.querySelector('[data-price-for="10300-1"]'));
    assert.match(kachel, /Geschenk/);
    assert.doesNotMatch(kachel, /%/, `Kachel: ${kachel}`);
    assert.match(text(d.querySelector('[data-price-for="21318-1"]')), /[−-]6[.,]9/, 'das andere Set behält sein Prozent');

    await reiter(w, 'finance');
    await warte(() => d.querySelector('#fin-tbl tbody tr'));
    const zeile = d.querySelector('#fin-tbl tbody tr');
    assert.equal(text(zeile.querySelector('.fin-guv')), 'Geschenk');
    assert.match(zahl(text(zeile.querySelectorAll('.price-cell')[0])), /^(EUR)?0\.00(€)?$/);

    await reiter(w, 'gallery');
    d.querySelector('#gallery [data-click="openModal"]').click();
    await warte(() => text(d.getElementById('m-market-rows')).includes('Geschenk'));
    assert.match(zahl(text(d.getElementById('set-modal'))), /(EUR0\.00|0\.00€)/, 'Kaufpreis im Detail');
    assert.match(d.getElementById('m-img').getAttribute('src'), /set-placeholder\.svg$/);
  } finally { w.close(); }
});

test('Set ohne Bild: derselbe Würfel wie in der Kachel', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const wuerfel = html.match(/<symbol id="i-set"[^>]*>(.*?)<\/symbol>/)[1];
  const bild = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'set-placeholder.svg'), 'utf8');
  for (const pfad of wuerfel.match(/d="[^"]+"/g)) assert.ok(bild.includes(pfad), `${pfad} fehlt im Platzhalterbild`);
});

test('Menüseite: kein Reiter markiert, Name im Kopf', async () => {
  const { w, d } = await oeffneOberflaeche({ '/v1/auth/profile': { success: true, user: { username: 'anna' } } });
  try {
    await sicht(w, 'profil');
    assert.deepEqual([...d.querySelectorAll('.ntab[aria-current], .ntab.gruppe-aktiv, .ntab.active')].map(x => x.dataset.tab), []);
    assert.equal(d.getElementById('kopf-sicht').hidden, false);
    assert.equal(text(d.getElementById('kopf-sicht')), 'Konto');
    assert.match(d.title, /^Konto – /);
    await reiter(w, 'finance');
    assert.equal(d.getElementById('kopf-sicht').hidden, true, 'Name bleibt nach dem Reiterwechsel stehen');
    assert.equal(d.querySelector('.ntab[aria-current="page"]')?.dataset.tab, 'finance');
    assert.match(d.title, /^Portfolio-Wert – /);
  } finally { w.close(); }
});

test('Import als ein Menü', async () => {
  const { w, d } = await oeffneOberflaeche({});
  try {
    for (const tab of ['gallery', 'parts', 'minifigs']) {
      const leiste = d.querySelector(`#tab-${tab} .erfassen-leiste`);
      assert.deepEqual([...leiste.children].map(e => e.tagName + '.' + e.className), ['BUTTON.btn bp', 'DETAILS.import-menue'], tab);
      const menue = leiste.querySelector('details');
      assert.equal(menue.querySelectorAll('.import-klappe > *').length, 3, `${tab}: drei Importwege`);
      menue.open = true;
      d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert.equal(menue.open, false, `${tab}: Escape schliesst das Menü`);
    }
  } finally { w.close(); }
});

test('Thema ganz', async () => {
  const { w, d } = await oeffneOberflaeche(SETS);
  try {
    await warte(() => d.querySelector('#gallery .smeta-text'));
    const thema = d.querySelector('[data-arg="10300-1"] .smeta-text');
    assert.match(text(thema), /Icons \/ Modular Buildings Collection$/);
    assert.equal(thema.getAttribute('title'), 'Icons / Modular Buildings Collection');
  } finally { w.close(); }
});

const zeitpunkte = ['2026-08-01', '2026-09-01', '2026-10-01', '2026-10-29'];
const VERLAUF = { success: true, currency: 'EUR', period_change_pct: 5, messpunkte: 4,
  points: [1700, 1750, 1720, 1850].map((value, i) => ({ x_label: zeitpunkte[i], value })),
  chart: { values: [{ values: zeitpunkte.map(x => ({ x })) }] } };

test('Wertdiagramm: Währung, Einstand, Achsenbruch, Fadenkreuz per Tastatur', async () => {
  const { w, d } = await oeffneOberflaeche({ ...SETS, '/v1/finance/portfolio-history': VERLAUF,
    '/v1/finance/pnl': { ...SETS['/v1/finance/pnl'], totals: { grand_total: '1850', purchase: '1568.98' } } });
  try {
    await reiter(w, 'finance');
    await warte(() => d.querySelector('#portfolio-chart svg'));
    const svg = d.querySelector('#portfolio-chart svg');
    const achse = [...svg.querySelectorAll('text[text-anchor="end"]')].filter(t => +t.getAttribute('x') < 90).map(text);
    assert.ok(achse.length >= 3 && achse.every(t => /€|EUR/.test(t)), `Achse: ${achse.join(' | ')}`);
    assert.match(zahl(text(svg.querySelector('.einstand-linie'))), /^Einstand(EUR)?1568\.98(€)?$/);
    assert.equal(svg.querySelector('.einstand-linie line').getAttribute('stroke-dasharray'), '6 4');
    assert.ok(svg.querySelector('.achsenbruch'), 'die Achse beginnt nicht bei 0 und zeigt das nicht');
    assert.match(svg.getAttribute('aria-label'), /beginnt bei \D*1\D?500[.,]00/);
    svg.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    const fk = svg.querySelector('.fadenkreuz');
    assert.equal(fk.getAttribute('visibility'), 'visible');
    assert.match(zahl(text(fk.querySelector('.fk-text'))), /01\.?10\.?2026.*1720\.00/);
    assert.match(zahl(text(svg.parentElement.querySelector('.diagramm-ansage'))), /1720\.00/);
  } finally { w.close(); }
});

test('Zeitraum ohne Verlauf', async () => {
  const { w, d } = await oeffneOberflaeche({ ...SETS,
    '/v1/finance/portfolio-history': { success: true, currency: 'EUR', points: [], messpunkte: 0 } });
  try {
    await reiter(w, 'finance');
    await warte(() => d.querySelector('#portfolio-chart .diagramm-leer'));
    assert.deepEqual([...d.querySelectorAll('.zeitraum-wahl .period-btn')].map(b => b.disabled), [true, true, true, true]);
    w.document.querySelector('.zeitraum-wahl .period-btn[data-period="week"]').disabled = false;
    w.document.querySelector('.zeitraum-wahl .period-btn[data-period="week"]').click();
    await takt(50);
    assert.ok(d.querySelector('#fin-filter [data-art=""]').classList.contains('active'), 'der Chip „Alle“ verlor seine Wahl');
  } finally { w.close(); }
});

test('Platzhalter je Sprache', async () => {
  for (const [sprache, erwartet] of [['de', 'z. B. 79,99'], ['en', 'e.g. 79.99']]) {
    const { w, d } = await oeffneOberflaeche({}, { sprache });
    try { assert.equal(d.getElementById('add-price').placeholder, erwartet); } finally { w.close(); }
  }
});
