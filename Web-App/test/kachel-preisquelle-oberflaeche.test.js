/**
 * Die Sammlungskachel nennt, woher ihr Betrag stammt. Ohne Marktpreis liefert
 * der Server den Kaufpreis als kachel_preis — mit kachel_quelle 'kauf', und
 * die Kachel schreibt „Kaufpreis“ statt „Marktpreis“. Die Werte kommen aus der
 * echten Serverrechnung (kachelWerte), gezeigt vom echten Bündel in jsdom.
 *
 * Gegenproben (am 03.11.2026 gemessen):
 *   A  in preisZeile() wieder `markt = !!s._price` → rot: „ohne Marktpreis“
 *      (Kachel zeigte „Marktpreis 99,99 €“)
 *   B  in kachelWerte() kachel_quelle immer 'markt' → rot: „ohne Marktpreis“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const _req = require('./helpers/sources').buildAndRequire();
const { kachelWerte } = _req('src/finanzen/setValue.js');
const { oeffneOberflaeche, warte } = require('./helpers/oberflaeche');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const zeile = (nr, markt, kauf) => ({
  set_number: nr,
  quantity: 1,
  current_price: markt,
  purchase_price: kauf,
  baseline_price: kauf,
  pnl_pct: null,
  baseline_pnl_pct: null,
});

test('Kachelpreis: Markt- und Kaufpreis beschriftet, wie der Server sie liefert', async () => {
  const k = kachelWerte([zeile('42115-1', 0, 99.99), zeile('21318-1', 186.2, 199.99)]);
  assert.equal(k.get('42115-1').kachel_quelle, 'kauf');
  assert.equal(k.get('21318-1').kachel_quelle, 'markt');
  const { w, d } = await oeffneOberflaeche({
    '/v1/sets': {
      success: true,
      total: 2,
      themes: [],
      sets: [
        { set_number: '42115-1', name: 'Lamborghini', year: 2020, quantity: 1, avg_purchase_price: 99.99 },
        { set_number: '21318-1', name: 'Tree House', year: 2019, quantity: 1, avg_purchase_price: 199.99 },
      ],
    },
    '/v1/finance/pnl': {
      success: true,
      currency: 'EUR',
      totals: {},
      sets: ['42115-1', '21318-1'].map(nr => ({ set_number: nr, quantity: 1, ...k.get(nr) })),
    },
  });
  try {
    await warte(() => /preis/.test(text(d.querySelector('[data-price-for="21318-1"] .preis-art'))));
    await warte(() => d.querySelector('[data-price-for="42115-1"] .preis-art'));
    assert.equal(text(d.querySelector('[data-price-for="42115-1"] .preis-art')), 'Kaufpreis', 'ohne Marktpreis');
    assert.equal(text(d.querySelector('[data-price-for="21318-1"] .preis-art')), 'Marktpreis');
  } finally {
    w.close();
  }
});
