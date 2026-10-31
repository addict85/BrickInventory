/**
 * Finanzen: Oben stehen IMMER Kennzahlen. Der Einstand (Summe der
 * Kaufpreise) ist immer bekannt; Gesamtwert und G&V nur mit Marktpreisen,
 * sonst sagt die Kachel, für wie viele Positionen der Preis fehlt. Die
 * Summenzeilen zeigen den Einstand auch ohne Marktwert. Geprüft am echten
 * Bündel in jsdom mit Antworten in der Form des Servers.
 *
 * Gegenproben (am 28.10. gemessen):
 *   A  zeigeKennzahlen() nicht aufgerufen → rot: beide Fälle („Einstand fehlt oben“)
 *   B  summenZellen() ohne Einstandszelle → rot: „ohne Marktpreise“
 *      („Die Summenzeile der Sets zeigt den Einstand nicht“)
 *   C  Zähler ohnePreis ohne die Teile → rot: beide Fälle (3 statt 4, 2 statt 3)
 *   E  den Leerzustand in renderFinance entfernt → rot: „nichts erfasst“
 *      (fünfmal „fehlt“; 28.10.)
 *   D  G&V-Betrag wieder als Gesamtwert − Einstand → rot: „mit Marktpreisen“
 *      (−397.93 neben +11.3 %; 28.10.)
 *   F  die G&V-Kachel wieder ohne Preise ausgeblendet (display none) → rot:
 *      „ohne Marktpreise“ („G&V-Kachel verschwindet“; 30.10.)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const zahl = s => s.replace(/[’'’\s]/g, '');

function antworten({ mitPreis }) {
  const setPreis = mitPreis ? 700 : 0;
  return {
    '/v1/finance/valuation': { success: true, currency: 'EUR',
      totals: { min: mitPreis ? '650' : '0', avg: String(setPreis), max: mitPreis ? '760' : '0' },
      sets: [
        { set_number: '10294-1', name: 'Titanic', quantity: 1, purchase_price: 629, avg_price: setPreis, total_avg: String(setPreis), wert_gesamt: setPreis,
          acquisitions: [{ id: 1, condition: 'N', quantity: 1, purchase_price: 629, avg_price: setPreis || null, wert_gesamt: setPreis }],
          ...(mitPreis ? {} : { error: '10294-1 — kein BrickLink-Preis gefunden' }) },
        { set_number: '42143-1', name: 'Ferrari', quantity: 1, purchase_price: 399, avg_price: 0, total_avg: '0', wert_gesamt: 0,
          acquisitions: [{ id: 2, condition: 'N', quantity: 1, purchase_price: 399, wert_gesamt: 0 }], error: 'kein Preis' },
      ] },
    '/v1/finance/parts-valuation': { success: true, currency: 'EUR', total_value: '0',
      parts: [{ part_number: '3001', part_name: 'Brick 2 x 4', color_name: 'Red', quantity: 7, purchase_price: 9.99, avg_price: 0,
                acquisitions: [{ id: 3, condition: 'U', quantity: 7, purchase_price: 9.99 }] }] },
    '/v1/finance/minifigs-valuation': { success: true, currency: 'EUR', total_value: '0',
      figs: [{ fig_number: 'fig-1', fig_name: 'Chewbacca', quantity: 1, avg_price: 0, acquisitions: [] }] },
    '/v1/finance/pnl': { success: true, currency: 'EUR', sets: [],
      totals: { purchase: '1097.93', sets_purchase: '1028.00', parts_purchase: '69.93', figs_purchase: '0.00',
                grand_total: String(setPreis), pnl_pct: mitPreis ? 11.3 : null, pnl_prozent: mitPreis ? 11.3 : null,
                pnl_purchase: mitPreis ? '629.00' : '0.00', pnl_current: mitPreis ? '700.00' : '0.00' } },
  };
}

async function finanzen(opt) {
  const o = await oeffneOberflaeche(antworten(opt));
  await reiter(o.w, 'finance');
  await warte(() => o.d.querySelector('#fin-tbl tfoot'));
  return o;
}

test('ohne Marktpreise: Einstand oben und in den Summen, Hinweis statt „—“', async () => {
  const { w, d } = await finanzen({ mitPreis: false });
  try {
    assert.match(zahl(text(d.getElementById('fin-einstand'))), /1097\.93/, 'Einstand fehlt oben');
    assert.equal(text(d.getElementById('fin-wert')), 'Marktpreis fehlt für 4 Positionen');
    // Die G&V-Kachel bleibt stehen (die Reihe springt nicht) und sagt, was fehlt.
    assert.notEqual(d.getElementById('fin-stat-pnl').style.display, 'none', 'G&V-Kachel verschwindet');
    assert.equal(text(d.getElementById('fin-total-pnl')), '—');
    assert.equal(text(d.getElementById('fin-pnl-sub')), 'Braucht Kauf- und Marktpreise');
    const setsFuss = d.querySelector('[data-fin-art="sets"] tfoot');
    assert.match(zahl(text(setsFuss)), /1028\.00/, 'Die Summenzeile der Sets zeigt den Einstand nicht');
    const summe = d.querySelector('.dt-summe tfoot');
    assert.match(zahl(text(summe)), /1097\.93/, 'Die Gesamtsumme zeigt den Einstand nicht');
  } finally { w.close(); }
});

test('mit Marktpreisen: Gesamtwert und G&V', async () => {
  const { w, d } = await finanzen({ mitPreis: true });
  try {
    assert.match(zahl(text(d.getElementById('fin-wert'))), /700\.00/);
    assert.match(text(d.getElementById('fin-wert-sub')), /Marktpreis fehlt für 3 Positionen/);
    assert.notEqual(d.getElementById('fin-stat-pnl').style.display, 'none');
    assert.match(text(d.getElementById('fin-total-pnl')), /11\.3/);
    // Betrag aus denselben Posten wie die Prozentzahl: 700 − 629, nicht 700 − 1097.93.
    assert.match(zahl(text(d.getElementById('fin-pnl-sub'))), /^\+.*71\.00$/,
      `Betrag passt nicht zur Prozentzahl: ${text(d.getElementById('fin-pnl-sub'))}`);
  } finally { w.close(); }
});

test('nichts erfasst: ein Leerzustand, kein „Preis fehlt“', async () => {
  const o = await oeffneOberflaeche({});
  try {
    await reiter(o.w, 'finance');
    await warte(() => o.d.querySelector('#fin-tbl .leer'));
    const finanzen = text(o.d.getElementById('tab-finance'));
    assert.equal((finanzen.match(/fehlt/gi) || []).length, 0, `meldet „fehlt“: ${finanzen.slice(0, 300)}`);
    assert.match(text(o.d.querySelector('#fin-tbl .leer')), /Noch nichts zu bewerten/);
  } finally { o.w.close(); }
});
