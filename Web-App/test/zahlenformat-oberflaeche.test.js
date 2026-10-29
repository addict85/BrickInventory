/**
 * Prozente und Beträge in derselben Schreibweise — am echten Bündel in jsdom.
 *
 *   - Auf der Set-Kachel steht die G&V in der Form der Oberflächensprache:
 *     de-DE „+51,1 %“ neben „411,90 €“, en-GB „+51.1%“ neben „€411.90“.
 *     Vorher stand dort von Hand „+51.1%“ neben „411,90 €“.
 *
 * Gegenprobe (am 28.10.2026 gemessen):
 *   A  pnlBadge() wieder `${v>0?'+':''}${v.toFixed(1)}%` → rot: „de-DE: G&V
 *      auf der Kachel in der Form der Oberfläche“ (actual „+51.1%“)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte } = require('./helpers/oberflaeche');

const SET = { set_number: '10300-1', name: 'Zeitmaschine', year: 2022, theme: 'Icons', quantity: 1,
  added_at: '2026-10-01T00:00:00Z', avg_purchase_price: 272.5, conditions: ['N'] };
const ANTWORTEN = {
  '/v1/sets': { success: true, sets: [SET], total: 1, themes: [] },
  '/v1/finance/pnl': { success: true, currency: 'EUR', sets: [
    { set_number: '10300-1', quantity: 1, current_price: 411.9, pnl_pct: 51.1, baseline_price: 272.5 }], totals: {} },
};

for (const [sprache, browser, preis, guv] of [['de', 'de-DE', '411,90 €', '+51,1 %'], ['en', 'en-GB', '€411.90', '+51.1%']]) {
  test(`${browser}: G&V auf der Kachel in der Form der Oberfläche`, async () => {
    const { w, d } = await oeffneOberflaeche(ANTWORTEN, { sprache, browserSprache: browser });
    try {
      await warte(() => d.querySelector('[data-price-for="10300-1"] .pnl-pos'));
      const feld = d.querySelector('[data-price-for="10300-1"]');
      assert.ok(feld, 'Keine Preiszeile auf der Kachel');
      const text = feld.textContent.replace(/ /g, ' ');
      assert.ok(text.includes(preis), `Preis: „${text}“`);
      assert.equal(feld.querySelector('.pnl-pos').textContent.replace(/ /g, ' '), guv);
    } finally { w.close(); }
  });
}
