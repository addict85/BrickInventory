/**
 * Vorleser: Jeder Dialog hat einen Namen, und Meldungen werden angesagt —
 * Fehler sofort. Am echten Bündel in jsdom.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  aria-labelledby an set-modal entfernt → rot: „jeder Dialog hat einen
 *      Namen“ (set-modal)
 *   B  role="alert" für Fehlermeldungen entfernt → rot: „Meldungen werden
 *      angesagt“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte } = require('./helpers/oberflaeche');

test('jeder Dialog hat einen Namen', async () => {
  const { w, d } = await oeffneOberflaeche();
  try {
    const dialoge = [...d.querySelectorAll('[role="dialog"]')];
    assert.ok(dialoge.length >= 15, `nur ${dialoge.length} Dialoge gefunden`);
    const ohne = dialoge.filter(dl => {
      if ((dl.getAttribute('aria-label') || '').trim()) return false;
      const ids = (dl.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
      return !ids.some(id => d.getElementById(id) && dl.contains(d.getElementById(id))
        && (d.getElementById(id).textContent.trim() || d.getElementById(id).id));
    }).map(dl => dl.id);
    assert.deepEqual(ohne, []);
  } finally { w.close(); }
});

test('Meldungen werden angesagt', async () => {
  const { w, d } = await oeffneOberflaeche();
  try {
    const behaelter = d.getElementById('toasts');
    assert.equal(behaelter.getAttribute('aria-live'), 'polite');
    // Ein Import ohne Datei meldet einen Fehler.
    d.getElementById('csv-file').dispatchEvent(new w.Event('change', { bubbles: true }));
    await warte(() => behaelter.querySelector('.toast.error'));
    assert.equal(behaelter.querySelector('.toast.error').getAttribute('role'), 'alert');
  } finally { w.close(); }
});
