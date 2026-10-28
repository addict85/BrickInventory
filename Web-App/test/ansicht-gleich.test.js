/**
 * Sets, Teile und Minifiguren wechseln die Ansicht mit denselben Knöpfen
 * (Karten/Tabelle) statt teils mit Knöpfen, teils mit einem Auswahlfeld. Am
 * echten Bündel in jsdom.
 *
 * Gegenprobe (am 28.10.2026 gemessen): in ansichtWaehlen() das change-Ereignis
 * nicht ausgelöst → rot: „Teile: die Tabelle lädt die Set-Zuordnung“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, takt } = require('./helpers/oberflaeche');

test('dieselben Ansichtsknöpfe in allen drei Reitern', async () => {
  const { w, d } = await oeffneOberflaeche();
  try {
    for (const tab of ['tab-gallery', 'tab-parts', 'tab-minifigs']) {
      const gruppe = d.querySelector(`#${tab} .vtgl[role="group"]`);
      assert.ok(gruppe, `${tab}: keine Ansichtsknöpfe`);
      assert.equal(gruppe.querySelectorAll('button.vb[aria-pressed]').length, 2, `${tab}: nicht Karten und Tabelle`);
    }
    assert.equal(d.querySelectorAll('select#parts-view:not(.vh), select#figs-view:not(.vh)').length, 0,
      'ein sichtbares Auswahlfeld für die Ansicht ist geblieben');
  } finally { w.close(); }
});

test('Teile: die Tabelle lädt die Set-Zuordnung', async () => {
  const { w, d, aufrufe } = await oeffneOberflaeche();
  try {
    await reiter(w, 'parts');
    await takt(500);     // erst das Laden des Reiters abwarten
    const vorher = aufrufe.length;
    const knopf = d.querySelector('[data-click="ansichtWaehlen"][data-arg="parts-view"][data-arg2="table"]');
    knopf.click();
    await takt(200);
    assert.ok(aufrufe.slice(vorher).some(a => /\/v1\/parts\?.*with_sets=1/.test(a.url)),
      'der Wechsel hat nicht neu geladen');
    assert.equal(d.getElementById('parts-view').value, 'table');
    assert.equal(knopf.getAttribute('aria-pressed'), 'true');
    assert.equal(d.querySelector('[data-arg="parts-view"][data-arg2="grid"]').getAttribute('aria-pressed'), 'false');
  } finally { w.close(); }
});
