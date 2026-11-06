/**
 * Ohne gespeichertes Ausgabeland gilt das Land zur Kontowährung — in der
 * Oberfläche und bei der Guthaben-Abfrage des Servers dieselbe Regel. Vorher
 * stand bei einem EUR-Konto „Schweiz“ vorgewählt, und jede EUR-Karte trug
 * sofort den Hinweis „nicht CHF wie das Ausgabeland“.
 *
 * Gegenproben (am 03.11.2026 gemessen):
 *   A  in ladeGutscheine() wieder `_settingsCache?.gutschein_land || 'de-CH'` → rot: „EUR-Konto“
 *   B  landFuerWaehrung() gibt immer LAND_STANDARD → rot: „Server: …“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const _req = require('./helpers/sources').buildAndRequire();
const { landFuerWaehrung } = _req('src/gutscheine/gutscheinGuthaben.js');
const { oeffneOberflaeche, sicht, warte } = require('./helpers/oberflaeche');

test('Server: Land zur Kontowährung', () => {
  assert.deepEqual(['CHF', 'EUR', 'GBP', 'USD', 'JPY'].map(landFuerWaehrung), ['de-CH', 'de-DE', 'en-GB', 'en-US', 'de-CH']);
});

test('EUR-Konto ohne gespeichertes Land: Deutschland, kein Abweichungshinweis', async () => {
  const { w, d } = await oeffneOberflaeche({
    '/v1/settings/raw': { success: true, settings: { currency: 'EUR', language: 'de', rebrickable_api_key: 'probe' } },
    '/v1/vouchers': { success: true, vouchers: [{ id: 3, number: '6123456789012', pin: '', amount: 50, currency: 'EUR', hat_pdf: false }] } });
  try {
    await sicht(w, 'gutscheine');
    await warte(() => d.querySelector('.voucher-row'));
    assert.equal(d.getElementById('gutschein-land').value, 'de-DE', 'EUR-Konto');
    assert.equal(d.querySelector('.voucher-abweichung'), null);
    assert.equal(d.getElementById('v-currency').value, 'EUR');
  } finally { w.close(); }
});
