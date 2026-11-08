/**
 * Die Merkliste heißt auf Englisch „Wishlist“, nicht „Wanted“ (das ist BrickLinks Wort für den Import).
 * Geprüft an dem, was die englische Oberfläche zeigt: Reiter, Titel, Suchfeld, Leerzustand, Meldungen und die
 * Beschriftung des Export-Knopfs in den Einstellungen. Die BrickLink-Import-Texte nennen weiter „wanted list“.
 *
 * Gegenproben (08.11.2026 gemessen, je einzeln):
 *   A  'nav.wanted' in en.js wieder 'Wanted' → rot: „Reiter und Merkliste“ (Beschriftung „Wanted“)
 *   B  'wanted.search' wieder „Search the wanted list…“ → rot: „Reiter und Merkliste“ (Suchfeld)
 *   C  'wanted.empty' wieder „…wanted list yet“ → rot: „Reiter und Merkliste“ (Leerzustand)
 *   D  'settings.data_zip_btn' wieder „watchlist“ → rot: „Export-Knopf“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter } = require('./helpers/oberflaeche');

const sichtbar = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();

test('englisch: Reiter und Merkliste heißen „Wishlist“', async () => {
  const o = await oeffneOberflaeche({ '/v1/wanted': { success: true, items: [], total: 0 } }, { sprache: 'en' });
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

test('englisch: Export-Knopf der Einstellungen nennt die „wishlist“', async () => {
  const o = await oeffneOberflaeche({}, { sprache: 'en' });
  try {
    const knopf = o.d.querySelector('[data-i18n="settings.data_zip_btn"]');
    assert.ok(knopf, 'Export-Knopf nicht gefunden');
    assert.equal(sichtbar(knopf), 'Export sets, parts, minifigures, wishlist & alerts (ZIP)');
  } finally {
    o.w.close();
  }
});
