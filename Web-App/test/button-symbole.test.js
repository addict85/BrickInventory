/**
 * No button carries a text plus: icons come from the icon family
 * (data-ico / <svg class="ico">). “+ Hinzufügen” under “Teileliste” was
 * the only add button with a text plus next to buttons with an icon. Checked
 * after translation in the real bundle (jsdom), German and English.
 *
 * Counter-check (measured on 28.10.): adding.button back to “+ Hinzufügen” →
 * red: “no button starts with a plus (de)”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi } = require('./helpers/ui');

for (const sprache of ['de', 'en']) {
  test(`no button starts with a plus (${sprache})`, async () => {
    const { w, d } = await openUi({}, { sprache });
    try {
      const knoepfe = [...d.querySelectorAll('button, .btn')];
      assert.ok(knoepfe.length > 100, 'Knöpfe nicht gefunden');
      // A plus before a WORD; the zoom plus in the PDF viewer is its own character.
      const withPlus = knoepfe.map(k => k.textContent.trim()).filter(t => /^[+＋]\s*\p{L}/u.test(t));
      assert.deepEqual(withPlus, []);
      const pl = d.querySelector('[data-click="plAddSet"]');
      assert.equal(pl.querySelector('use')?.getAttribute('href'), '#i-plus', 'Teileliste: Knopf ohne Plus-Symbol');
    } finally {
      w.close();
    }
  });
}
