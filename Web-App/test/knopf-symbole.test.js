/**
 * Kein Knopf trägt ein Text-Plus: Symbole kommen aus der Symbolfamilie
 * (data-ico / <svg class="ico">). „+ Hinzufügen“ unter „Teileliste“ stand
 * als einziger Erfassen-Knopf mit Text-Plus neben Knöpfen mit Symbol. Geprüft
 * nach dem Übersetzen im echten Bündel (jsdom), deutsch und englisch.
 *
 * Gegenprobe (am 28.10. gemessen): adding.button wieder „+ Hinzufügen“ →
 * rot: „kein Knopf beginnt mit einem Plus (de)“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche } = require('./helpers/oberflaeche');

for (const sprache of ['de', 'en']) {
  test(`kein Knopf beginnt mit einem Plus (${sprache})`, async () => {
    const { w, d } = await oeffneOberflaeche({}, { sprache });
    try {
      const knoepfe = [...d.querySelectorAll('button, .btn')];
      assert.ok(knoepfe.length > 100, 'Knöpfe nicht gefunden');
      // Ein Plus vor einem WORT; das Zoom-Plus im PDF-Betrachter ist ein eigenes Zeichen.
      const mitPlus = knoepfe.map(k => k.textContent.trim()).filter(t => /^[+＋]\s*\p{L}/u.test(t));
      assert.deepEqual(mitPlus, []);
      const pl = d.querySelector('[data-click="plAddSet"]');
      assert.equal(pl.querySelector('use')?.getAttribute('href'), '#i-plus', 'Teileliste: Knopf ohne Plus-Symbol');
    } finally { w.close(); }
  });
}

