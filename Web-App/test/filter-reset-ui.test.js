/**
 * “Reset filter” in the empty state without results — on the real bundle in
 * jsdom.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  in renderGallery `button: resetButton('gallery')` removed → red:
 *      “collection: search without results” and “collection: theme filter without results”
 *   B  `filtered` again only `q` → red: “collection: theme filter without results”
 *   C  in resetFilter the branch 'wanted' removed → red:
 *      “wishlist: search without results”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, warte, takt } = require('./helpers/ui');

const EMPTY = { '/v2/sets': { success: true, sets: [], total: 0, themes: ['Icons'] } };

test('collection: search without hits', async () => {
  const { w, d, aufrufe } = await openUi(EMPTY);
  try {
    d.getElementById('gs').value = 'xyz';
    d.getElementById('gs').dispatchEvent(new w.Event('input'));
    await warte(() => d.querySelector('#gallery [data-click="resetFilter"]'));
    const knopf = d.querySelector('#gallery [data-click="resetFilter"]');
    assert.ok(knopf, 'Kein Knopf „Filter zurücksetzen“');
    assert.equal(knopf.textContent.trim(), 'Filter zurücksetzen');
    const vorher = aufrufe.length;
    knopf.click();
    await takt(30);
    assert.equal(d.getElementById('gs').value, '');
    const neu = aufrufe.slice(vorher).find(a => a.url.includes('/v2/sets?'));
    assert.ok(neu, 'Die Sammlung wurde nicht neu geladen');
    assert.doesNotMatch(neu.url, /search=/);
  } finally {
    w.close();
  }
});

test('collection: theme filter without hits', async () => {
  const { w, d } = await openUi(EMPTY);
  try {
    await warte(() => d.querySelector('#gtheme option[value="Icons"]'));
    d.getElementById('gtheme').value = 'Icons';
    d.getElementById('gtheme').dispatchEvent(new w.Event('change'));
    await warte(() => d.querySelector('#gallery .empty-state h2')?.textContent.includes('Filter'));
    assert.equal(d.querySelector('#gallery .empty-state h2').textContent, 'Keine Sets passen zu diesem Filter');
    assert.ok(d.querySelector('#gallery [data-click="resetFilter"]'));
  } finally {
    w.close();
  }
});

test('wishlist: search without hits', async () => {
  const { w, d } = await openUi({ '/v2/wanted': { success: true, item: [] } });
  try {
    await reiter(w, 'wanted');
    d.getElementById('mks').value = 'xyz';
    d.getElementById('mks').dispatchEvent(new w.Event('input'));
    await warte(() => d.querySelector('#mk-list [data-click="resetFilter"]'));
    d.querySelector('#mk-list [data-click="resetFilter"]').click();
    await takt(30);
    assert.equal(d.getElementById('mks').value, '');
    await warte(() => !d.querySelector('#mk-list [data-click="resetFilter"]'));
    assert.equal(
      d.querySelector('#mk-list [data-click="resetFilter"]'),
      null,
      'Nach dem Zurücksetzen steht weiter „nichts gefunden“',
    );
  } finally {
    w.close();
  }
});
