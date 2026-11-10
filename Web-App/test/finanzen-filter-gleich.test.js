/**
 * Der Kategoriefilter der Finanzen steht in BEIDEN Oberflächen — gleich: dieselben Arten, „leer heisst
 * alle“, additiv. Die Webapp läuft in jsdom (echtes Bündel), die App wird als Struktur gelesen (kein
 * Android-SDK hier).
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln, zurückgenommen, Bündel neu gebaut):
 *   A  finFilter() ersetzt die Auswahl (`finKategorien.clear()` vor dem Hinzufügen) → rot:
 *      „Webapp: der Filter häuft …“
 *   B  in der Zeichenfunktion den Aufruf `finFilterAnwenden();` nach setzeHtml gestrichen → rot:
 *      „Webapp: … überlebt das Neuzeichnen“
 *   C  im Markup den Chip data-arg="figs" auf "minifigs" → rot: „dieselben Arten …“
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const { ohneKommentare } = require('./helpers/sources');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

// Jeder Pfad ausgeschrieben: baumbruecken.test.js löst die Brücken in den Android-Baum statisch auf.
const KT_ABSCHNITTE = path.join(__dirname, '..', '..', 'Android-App', 'feature-finanzen', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'finanzen', 'ui', 'screens', 'FinanceSections.kt');
const KT_ZUSTAND = path.join(__dirname, '..', '..', 'Android-App', 'feature-finanzen', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'finanzen', 'ui', 'ZustandFinanzen.kt');
const kt = (voll) => ohneKommentare(fs.readFileSync(voll, 'utf8'));

const posten = (feld, nr, name) => ({ [`${feld}_number`]: nr, [`${feld}_name`]: name, quantity: 1, condition: 'N', conditions: ['N'],
  acquisitions: [], avg_price: 2, purchase_price: 1, wert_gesamt: 2, total_value: '2.00', display_value: '2.00' });

async function finanzen() {
  const o = await oeffneOberflaeche({
    '/v1/finance/valuation': { success: true, currency: 'EUR', condition: 'N', total_value: '5', kaufpreise_fremde_waehrung: 0,
      totals: { min: '0', avg: '5', max: '0', qty_avg: '5' },
      sets: [{ set_number: '10294-1', name: 'Titanic', quantity: 1, avg_price: 5, wert_gesamt: 5, from_cache: true,
               is_fallback: false, no_price: false, mixed: false, acquisitions: [] }] },
    '/v1/finance/parts-valuation': { success: true, currency: 'EUR', total_value: '2', wert_gesamt: 2,
      parts: [{ ...posten('part', '3001', 'Stein 2 x 4'), color_id: 5, color_name: 'Red' }] },
    '/v1/finance/minifigs-valuation': { success: true, currency: 'EUR', total_value: '2', wert_gesamt: 2,
      figs: [posten('fig', 'sw0001', 'Luke')] },
  });
  await reiter(o.w, 'finance');
  assert.ok(await warte(() => o.d.querySelectorAll('#fin-tbl [data-fin-art]').length === 3), 'nicht alle drei Abschnitte da');
  o.sichtbar = () => [...o.d.querySelectorAll('#fin-tbl [data-fin-art]')].filter(el => el.style.display !== 'none').map(el => el.dataset.finArt);
  o.chip = (art) => o.d.querySelector(`#fin-filter [data-click="finFilter"][data-arg="${art}"]`).click();
  return o;
}

test('dieselben Arten in Webapp und App, und jede hat einen Abschnitt', async () => {
  const appArten = [...kt(KT_ABSCHNITTE).matchAll(/KategorieChip\("(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(appArten, ['sets', 'parts', 'figs'], 'Die App kennt andere Arten als erwartet');
  const o = await finanzen();
  try {
    const webArten = [...o.d.querySelectorAll('#fin-filter [data-click="finFilter"]')].map(b => b.dataset.arg);
    assert.deepEqual(webArten, ['alle', ...appArten], 'Die Chips der Webapp decken sich nicht mit denen der App');
    // Ein Chip ohne zugehörigen Abschnitt wäre ein Knopf, der nichts tut.
    assert.deepEqual(o.sichtbar(), appArten);
  } finally { o.w.close(); }
});

test('Webapp: leer heisst alle, der Filter häuft und überlebt das Neuzeichnen', async () => {
  const o = await finanzen();
  try {
    o.chip('parts');
    assert.deepEqual(o.sichtbar(), ['parts']);
    o.chip('figs');
    assert.deepEqual(o.sichtbar(), ['parts', 'figs'], 'ein zweiter Chip ersetzt die Auswahl, statt sie zu häufen');
    assert.equal(o.d.querySelector('#fin-filter [data-arg="figs"]').getAttribute('aria-pressed'), 'true');
    o.chip('parts');
    assert.deepEqual(o.sichtbar(), ['figs'], 'ein zweiter Klick nimmt die Art nicht wieder heraus');
    // Die Suche zeichnet die Tabelle neu: Der alte Abschnitt wird ersetzt.
    const vorher = o.d.querySelector('#fin-tbl [data-fin-art="figs"]');
    const feld = o.d.getElementById('fin-suche');
    feld.value = '0';
    feld.dispatchEvent(new o.w.Event('input', { bubbles: true }));
    assert.ok(await warte(() => !vorher.isConnected && o.d.querySelectorAll('#fin-tbl [data-fin-art]').length === 3, 1500), 'nicht neu gezeichnet');
    assert.deepEqual(o.sichtbar(), ['figs']);
    o.chip('figs');
    assert.deepEqual(o.sichtbar(), ['sets', 'parts', 'figs'], 'keine Auswahl heisst alle');
    assert.equal(o.d.querySelector('#fin-filter [data-arg="alle"]').getAttribute('aria-pressed'), 'true');
  } finally { o.w.close(); }
});

test('App: dieselbe Regel „leer heisst alle“, additiv', () => {
  const zustand = kt(KT_ZUSTAND);
  assert.match(zustand, /fun zeigt\(kategorie: String\): Boolean = kategorien\.isEmpty\(\) \|\| kategorie in kategorien/);
  // Ein Single-Select sähe fast gleich aus und verhielte sich anders.
  assert.match(zustand, /if \(kategorie in kategorien\) kategorien - kategorie/);
});
