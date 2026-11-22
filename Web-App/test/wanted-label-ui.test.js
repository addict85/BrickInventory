/**
 * In English the wishlist is called “Wishlist”, not “Wanted” (that is BrickLink's word for the import).
 * Checked against what the English UI shows: tab, title, search field, empty state, messages and the
 * label of the export button in the settings. The BrickLink import texts keep saying “wanted list”.
 *
 * Counter-checks (measured 08.11.2026, each individually):
 *   A  'nav.wanted' in en.js back to 'Wanted' → red: “English: tab and wishlist …” (label “Wanted”)
 *   B  'wanted.search' back to “Search the wanted list…” → red: “English: tab and wishlist …” (search field)
 *   C  'wanted.empty' back to “…wanted list yet” → red: “English: tab and wishlist …” (empty state)
 *   D  'settings.data_zip_btn' back to “watchlist” → red: “English: export button …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter } = require('./helpers/ui');

const sichtbar = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();

test('English: tab and wishlist are called “Wishlist”', async () => {
  const o = await openUi({ '/v2/wanted': { success: true, items: [], total: 0 } }, { language: 'en' });
  try {
    const { d, w } = o;
    assert.equal(sichtbar(d.querySelector('.ntab[data-tab="wanted"]')), 'Wishlist', 'Reiter');
    await reiter(w, 'wanted');
    const tab = d.getElementById('tab-wanted');
    assert.match(sichtbar(tab.querySelector('h1, .ptitle, .tab-titel') || tab), /Wishlist/);
    assert.equal(d.getElementById('mks').getAttribute('placeholder'), 'Search the wishlist…');
    assert.equal(d.getElementById('mks').getAttribute('aria-label'), 'Search the wishlist');
    const text = sichtbar(tab);
    assert.match(text, /Add a wishlist item/);
    assert.doesNotMatch(text, /wanted/i, `„wanted“ in der Merkliste: ${text.slice(0, 300)}`);
  } finally {
    o.w.close();
  }
});

test('English: export button of the settings names the “wishlist”', async () => {
  const o = await openUi({}, { language: 'en' });
  try {
    const knopf = o.d.querySelector('[data-i18n="settings.data_zip_btn"]');
    assert.ok(knopf, 'Export-Knopf nicht gefunden');
    assert.equal(sichtbar(knopf), 'Export sets, parts, minifigures, wishlist & alerts (ZIP)');
  } finally {
    o.w.close();
  }
});
