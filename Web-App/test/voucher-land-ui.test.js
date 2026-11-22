/**
 * Without a stored issuing country the country for the account currency applies — in the
 * UI and in the server's balance query the same rule. Before,
 * „Schweiz“ was preselected for an EUR account, and every EUR card immediately carried
 * the hint „nicht CHF wie das Ausgabeland“.
 *
 * Counter-checks (measured on 03.11.2026):
 *   A  in loadVouchers() again `einstellungsStand?.gutschein_land || 'de-CH'` → red: „EUR-Konto“
 *   B  landFuerWaehrung() always returns LAND_STANDARD → red: “server: …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const _req = require('./helpers/sources').buildAndRequire();
const { countryForCurrency } = _req('src/vouchers/balanceLookup.js');
const { openUi, sicht, warte } = require('./helpers/ui');

test('server: country for the account currency', () => {
  assert.deepEqual(['CHF', 'EUR', 'GBP', 'USD', 'JPY'].map(countryForCurrency), [
    'de-CH',
    'de-DE',
    'en-GB',
    'en-US',
    'de-CH',
  ]);
});

test('EUR account without a stored country: Germany, no deviation hint', async () => {
  const { w, d } = await openUi({
    '/v1/settings/raw': { success: true, settings: { currency: 'EUR', language: 'de', rebrickable_api_key: 'probe' } },
    '/v1/vouchers': {
      success: true,
      vouchers: [{ id: 3, number: '6123456789012', pin: '', amount: 50, currency: 'EUR', hat_pdf: false }],
    },
  });
  try {
    await sicht(w, 'vouchers');
    await warte(() => d.querySelector('.voucher-row'));
    assert.equal(d.getElementById('voucher-country').value, 'de-DE', 'EUR-Konto');
    assert.equal(d.querySelector('.voucher-deviation'), null);
    assert.equal(d.getElementById('v-currency').value, 'EUR');
  } finally {
    w.close();
  }
});
