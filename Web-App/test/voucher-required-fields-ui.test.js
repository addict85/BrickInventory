/**
 * Voucher form in jsdom: number and amount are marked as required, and an empty
 * form reports both gaps at once at the field, without a request to the server. With a chosen PDF
 * nothing is required (the server reads the values from it).
 *
 * Counter-checks (measured 16.11.2026, each on its own, bundle rebuilt):
 *   A  the check for empty fields deleted in saveVoucher() → red: “both gaps”
 *      (v-number without a message)
 *   B  only the first gap reported (fehlt.slice(0, 1)) → red: same place (v-amount without a message)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, sicht, warte } = require('./helpers/ui');

test('voucher: both gaps at once, required marked', async () => {
  const { w, d, aufrufe } = await openUi({ '/v2/vouchers': { success: true, vouchers: [] } });
  try {
    await sicht(w, 'vouchers');
    for (const id of ['v-number', 'v-amount']) {
      assert.match(d.querySelector(`label[for="${id}"]`).textContent, /\*$/, `${id} ohne Stern`);
      assert.equal(d.getElementById(id).getAttribute('aria-required'), 'true');
    }
    d.querySelector('[data-click="saveVoucher"]').click();
    await warte(() => d.getElementById('v-amount-error'));
    for (const id of ['v-number', 'v-amount']) {
      const f = d.getElementById(`${id}-error`);
      assert.ok(f && !f.hidden && /ausfüllen/.test(f.textContent), `${id}: keine Meldung`);
    }
    assert.equal(d.activeElement?.id, 'v-number', 'Fokus nicht im ersten leeren Feld');
    assert.equal(
      aufrufe.some(a => a.method === 'POST' && a.url.includes('/v2/vouchers')),
      false,
      'leeres Formular ging an den Server',
    );
  } finally {
    w.close();
  }
});
