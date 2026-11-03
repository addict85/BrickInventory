/**
 * Finanzen: Die Karten Einstand, Marktwert und Gewinn/Verlust widersprechen
 * sich nie. Der Server rechnet sie über dieselben Positionen (mit Kauf- und
 * Marktpreis, Geschenke mit 0), die Oberfläche zeigt genau diese Zahlen und
 * nennt, was nicht gerechnet ist. Geprüft wird die echte Serverrechnung
 * (basisDerKennzahlen) durch das echte Bündel in jsdom.
 *
 * Gegenproben (am 03.11.2026 gemessen):
 *   A  in zeigeKennzahlen() wieder einstandAlle statt basis.einstand → rot:
 *      „Einstand + G/V = Marktwert“
 *   B  in vergleichbareSummen() wieder nur Kaufpreis > 0 (Geschenk raus) → rot:
 *      beide Tests
 *   C  in basisDerKennzahlen() ohneKauf nicht gezählt → rot: „Server: Geschenk
 *      zählt mit …“ (Zähler [11, 5, 6, 0])
 *   D  Diagrammkopf wieder grandTotal → rot: „Diagrammkopf = Marktwert-Karte“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const _req = require('./helpers/sources').buildAndRequire();
const { basisDerKennzahlen, gesamtGuvProzent } = _req('src/finanzen/rechnung/gewinnVerlust.js');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
/** Zahl aus formatiertem Text, gleich welche Trennzeichen die Sprache setzt: „1’863.90“, „1.863,90 €“, „−21,8 %“. */
const betrag = s => {
  const m = String(s).match(/([−+-]?)\s*(\d[\d’'.,\u202f\u00a0]*)/);
  if (!m) return NaN;
  const roh = m[2].replace(/[’'\u202f\u00a0]/g, '').replace(/[.,]$/, '');
  const dez = roh.match(/[.,](\d{1,2})$/);
  const ganz = (dez ? roh.slice(0, -dez[0].length) : roh).replace(/[.,]/g, '');
  const v = Number(ganz + (dez ? '.' + dez[1] : ''));
  return m[1] === '−' || m[1] === '-' ? -v : v;
};

// Wie im Konto „anna“: drei Sets mit beiden Preisen, ein Geschenk, vier Sets
// ohne Marktpreis, ein Set ohne Kaufpreis, ein Teil und eine Figur ohne Marktpreis.
const SETS = [
  ['10294-1', 679.99, 712.40], ['75192-1', 650, 801.50], ['10300-1', 0, 163.80], ['21318-1', 199.99, 186.20],
  ['42115-1', 99.99, 0], ['60337-1', 99.99, 0], ['10497-1', 99.99, 0], ['71043-1', 99.99, 0], ['40000-1', null, 45],
];
const zeilen = [...SETS.map(([, k, m]) => ({ purchase_price: k, current_price: m, quantity: 1 })),
  { purchase_price: 0.12, current_price: 0, quantity: 250 }, { purchase_price: 4.5, current_price: 0, quantity: 2 }];

test('Server: Geschenk zählt mit, ohne Markt- oder Kaufpreis nicht', () => {
  const b = basisDerKennzahlen(zeilen);
  assert.equal(b.basis_marktwert, '1863.90');
  assert.equal(b.basis_einstand, '1529.98');
  assert.equal(b.basis_guv_betrag, '333.92');
  assert.deepEqual([b.positionen, b.positionen_bewertet, b.positionen_ohne_marktpreis, b.positionen_ohne_kaufpreis], [11, 4, 6, 1]);
  assert.equal(b.ohne_marktpreis_einstand, '438.96');
  assert.equal(b.ohne_kaufpreis_marktwert, '45.00');
  assert.equal(gesamtGuvProzent(zeilen), '21.8');
});

test('Oberfläche: Einstand + G/V = Marktwert, Prozent passt, Basis genannt', async () => {
  const b = basisDerKennzahlen(zeilen);
  const pct = gesamtGuvProzent(zeilen);
  const sets = SETS.map(([nr, k, m]) => ({ set_number: nr, name: nr, quantity: 1, purchase_price: k, avg_price: m, wert_gesamt: m,
    acquisitions: [], ...(m ? {} : { error: 'kein Preis' }) }));
  const { w, d } = await oeffneOberflaeche({
    '/v1/finance/valuation': { success: true, currency: 'EUR', totals: { min: '0', avg: '1908.90', max: '0' }, sets },
    '/v1/finance/parts-valuation': { success: true, currency: 'EUR', total_value: '0',
      parts: [{ part_number: '3001', part_name: 'Brick 2 x 4', quantity: 250, purchase_price: 0.12, avg_price: 0, acquisitions: [] }] },
    '/v1/finance/minifigs-valuation': { success: true, currency: 'EUR', total_value: '0',
      figs: [{ fig_number: 'fig-2', fig_name: 'Doc Brown', quantity: 2, purchase_price: 4.5, avg_price: 0, acquisitions: [] }] },
    '/v1/finance/pnl': { success: true, currency: 'EUR', sets: [],
      totals: { purchase: '1968.94', grand_total: '1908.90', pnl_prozent: Number(pct), pnl_pct: pct, ...b } },
    '/v1/finance/portfolio-history': { success: true, currency: 'EUR', messpunkte: 3, period_change_pct: 6.7,
      points: [{ x_label: 'Sep', value: 1700 }, { x_label: 'Okt', value: 1800 }, { x_label: 'Nov', value: 1908.9 }] },
  });
  try {
    await reiter(w, 'finance');
    await warte(() => d.querySelector('#fin-tbl tfoot') && d.getElementById('fin-sum').dataset.geladen);
    const einstand = betrag(text(d.getElementById('fin-einstand')));
    const wert = betrag(text(d.getElementById('fin-wert')));
    const guv = betrag(text(d.getElementById('fin-pnl-sub')));
    const prozent = betrag(text(d.getElementById('fin-total-pnl')));
    assert.equal(Math.round((einstand + guv) * 100), Math.round(wert * 100),
      `Einstand + G/V = Marktwert: ${einstand} + ${guv} ≠ ${wert}`);
    assert.equal(prozent, Math.round(guv / einstand * 1000) / 10, 'Prozent passt nicht zum Betrag');
    assert.equal(wert, 1863.9);
    const basis = text(d.getElementById('fin-basis'));
    assert.ok(!d.getElementById('fin-basis').hidden, 'Basiszeile fehlt');
    assert.match(basis, /4 von 11 Positionen/);
    assert.match(basis, /6 Positionen ohne Marktpreis nicht gerechnet \(Einstand [^)]*438[.,]96/);
    assert.match(basis, /1 Position ohne Kaufpreis nicht gerechnet/, 'Zeile nennt die Position ohne Kaufpreis');
    await warte(() => text(d.getElementById('portfolio-current')) !== '—');
    assert.equal(betrag(text(d.getElementById('portfolio-current'))), wert, 'Diagrammkopf = Marktwert-Karte');
  } finally { w.close(); }
});
