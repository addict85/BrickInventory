/**
 * Zählwörter folgen den Mehrzahlregeln der Sprache (Intl.PluralRules) — am
 * echten Bündel in jsdom.
 *
 *   - Teile, nach Farbe gruppiert: „1 Sorte“ und „2 Sorten“ (en: „1 kind“,
 *     „2 kinds“). Vorher stand fest „{n} Typen“, also „1 Typen“.
 *   - Finanzen ohne Marktpreis: „Marktpreis fehlt für 1 Position“.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  mehrzahlSchluessel() in i18n.js gibt immer `key` zurück → rot: alle drei,
 *      z. B. „1 Typen“ und „Marktpreis fehlt für 1 Positionen“
 *   B  'parts.group_types_one' aus locales/en.js entfernt → rot: „en: Gruppen
 *      der Teile“ (der Rückfall auf Deutsch ergab „1 Typ“)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

const TEILE = { '/v1/parts': { success: true, total: 3, parts: [
  { part_num: '3001', part_number: '3001', name: 'Brick 2 x 4', color_name: 'Red', color_hex: 'C91A09', color_id: 4, quantity: 4 },
  { part_num: '3003', part_number: '3003', name: 'Brick 2 x 2', color_name: 'Blue', color_hex: '0055BF', color_id: 1, quantity: 2 },
  { part_num: '3004', part_number: '3004', name: 'Brick 1 x 2', color_name: 'Blue', color_hex: '0055BF', color_id: 1, quantity: 6 },
] } };

for (const [sprache, eins, zwei] of [['de', '1 Sorte', '2 Sorten'], ['en', '1 kind', '2 kinds']]) {
  test(`${sprache}: Gruppen der Teile`, async () => {
    const { w, d } = await oeffneOberflaeche(TEILE, { sprache });
    try {
      await reiter(w, 'parts');
      await warte(() => d.querySelectorAll('#parts-main .parts-group').length === 2);
      const zaehler = [...d.querySelectorAll('#parts-main .parts-group .group-sub')].map(e => e.textContent.trim());
      assert.deepEqual(zaehler, [eins, zwei]);
    } finally { w.close(); }
  });
}

test('Finanzen: eine Position ohne Preis', async () => {
  const { w, d } = await oeffneOberflaeche({
    '/v1/finance/valuation': { success: true, currency: 'EUR', totals: { min: '0', avg: '0', max: '0', qty_avg: '0' },
      sets: [{ set_number: '10300-1', name: 'Zeitmaschine', quantity: 1, purchase_price: 199, avg_price: null, no_price: true }] },
  });
  try {
    await reiter(w, 'finance');
    await warte(() => d.getElementById('fin-wert').textContent.includes('Marktpreis'));
    assert.equal(d.getElementById('fin-wert').textContent.trim(), 'Marktpreis fehlt für 1 Position');
  } finally { w.close(); }
});
