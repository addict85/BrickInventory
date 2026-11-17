/**
 * Gutscheinformular in jsdom: Nummer und Betrag sind als Pflicht gekennzeichnet, und ein leeres
 * Formular meldet beide Lücken auf einmal am Feld, ohne Anfrage an den Server. Mit gewähltem PDF
 * ist nichts Pflicht (der Server liest die Werte daraus).
 *
 * Gegenproben (16.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  in gutscheinSpeichern() die Prüfung auf leere Felder gestrichen → rot: „beide Lücken“
 *      (v-number ohne Meldung)
 *   B  nur die erste Lücke gemeldet (fehlt.slice(0, 1)) → rot: ebenda (v-amount ohne Meldung)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, sicht, warte } = require('./helpers/oberflaeche');

test('Gutschein: beide Lücken auf einmal, Pflicht gekennzeichnet', async () => {
  const { w, d, aufrufe } = await oeffneOberflaeche({ '/v1/vouchers': { success: true, vouchers: [] } });
  try {
    await sicht(w, 'gutscheine');
    for (const id of ['v-number', 'v-amount']) {
      assert.match(d.querySelector(`label[for="${id}"]`).textContent, /\*$/, `${id} ohne Stern`);
      assert.equal(d.getElementById(id).getAttribute('aria-required'), 'true');
    }
    d.querySelector('[data-click="gutscheinSpeichern"]').click();
    await warte(() => d.getElementById('v-amount-fehler'));
    for (const id of ['v-number', 'v-amount']) {
      const f = d.getElementById(`${id}-fehler`);
      assert.ok(f && !f.hidden && /ausfüllen/.test(f.textContent), `${id}: keine Meldung`);
    }
    assert.equal(d.activeElement?.id, 'v-number', 'Fokus nicht im ersten leeren Feld');
    assert.equal(
      aufrufe.some(a => a.method === 'POST' && a.url.includes('/v1/vouchers')),
      false,
      'leeres Formular ging an den Server',
    );
  } finally {
    w.close();
  }
});
