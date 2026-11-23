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
const { openUi, switchTab, waitFor, tick } = require('./helpers/ui');

const EMPTY = { '/v2/sets': { success: true, sets: [], total: 0, themes: ['Icons'] } };

test('collection: search without hits', async () => {
  const { w, d, calls } = await openUi(EMPTY);
  try {
    d.getElementById('gs').value = 'xyz';
    d.getElementById('gs').dispatchEvent(new w.Event('input'));
    await waitFor(() => d.querySelector('#gallery [data-click="resetFilter"]'));
    const button = d.querySelector('#gallery [data-click="resetFilter"]');
    assert.ok(button, 'No button „Filter zurücksetzen“');
    assert.equal(button.textContent.trim(), 'Filter zurücksetzen');
    const prior = calls.length;
    button.click();
    await tick(30);
    assert.equal(d.getElementById('gs').value, '');
    const fresh = calls.slice(prior).find(a => a.url.includes('/v2/sets?'));
    assert.ok(fresh, 'The collection was not reloaded');
    assert.doesNotMatch(fresh.url, /search=/);
  } finally {
    w.close();
  }
});

test('collection: theme filter without hits', async () => {
  const { w, d } = await openUi(EMPTY);
  try {
    await waitFor(() => d.querySelector('#gtheme option[value="Icons"]'));
    d.getElementById('gtheme').value = 'Icons';
    d.getElementById('gtheme').dispatchEvent(new w.Event('change'));
    await waitFor(() => d.querySelector('#gallery .empty-state h2')?.textContent.includes('Filter'));
    assert.equal(d.querySelector('#gallery .empty-state h2').textContent, 'Keine Sets passen zu diesem Filter');
    assert.ok(d.querySelector('#gallery [data-click="resetFilter"]'));
  } finally {
    w.close();
  }
});

test('wishlist: search without hits', async () => {
  const { w, d } = await openUi({ '/v2/wanted': { success: true, item: [] } });
  try {
    await switchTab(w, 'wanted');
    d.getElementById('mks').value = 'xyz';
    d.getElementById('mks').dispatchEvent(new w.Event('input'));
    await waitFor(() => d.querySelector('#mk-list [data-click="resetFilter"]'));
    d.querySelector('#mk-list [data-click="resetFilter"]').click();
    await tick(30);
    assert.equal(d.getElementById('mks').value, '');
    await waitFor(() => !d.querySelector('#mk-list [data-click="resetFilter"]'));
    assert.equal(
      d.querySelector('#mk-list [data-click="resetFilter"]'),
      null,
      'After resetting it still says „nichts gefunden“',
    );
  } finally {
    w.close();
  }
});
