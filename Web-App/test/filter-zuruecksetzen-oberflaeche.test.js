/**
 * „Filter zurücksetzen“ im Leerzustand ohne Treffer — am echten Bündel in
 * jsdom.
 *
 *   - Sammlung: Eine Suche ohne Treffer zeigt den Knopf; ein Klick leert das
 *     Suchfeld und lädt ohne `search` neu.
 *   - Ein Themenfilter ohne Suchtext ist auch ein Filter: Es steht „Keine Sets
 *     passen zu diesem Filter“ mit Knopf, nicht „Noch keine Sets“.
 *   - Merkliste: dasselbe für die Suche.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  in renderGallery `knopf: zuruecksetzenKnopf('gallery')` entfernt → rot:
 *      „Sammlung: Suche ohne Treffer“ und „Sammlung: Themenfilter ohne Treffer“
 *   B  `gefiltert` wieder nur `q` → rot: „Sammlung: Themenfilter ohne Treffer“
 *   C  in filterZuruecksetzen den Zweig 'merkliste' entfernt → rot:
 *      „Merkliste: Suche ohne Treffer“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, warte, takt } = require('./helpers/oberflaeche');

const LEER = { '/v1/sets': { success: true, sets: [], total: 0, themes: ['Icons'] } };

test('Sammlung: Suche ohne Treffer', async () => {
  const { w, d, aufrufe } = await oeffneOberflaeche(LEER);
  try {
    d.getElementById('gs').value = 'xyz';
    d.getElementById('gs').dispatchEvent(new w.Event('input'));
    await warte(() => d.querySelector('#gallery [data-click="filterZuruecksetzen"]'));
    const knopf = d.querySelector('#gallery [data-click="filterZuruecksetzen"]');
    assert.ok(knopf, 'Kein Knopf „Filter zurücksetzen“');
    assert.equal(knopf.textContent.trim(), 'Filter zurücksetzen');
    const vorher = aufrufe.length;
    knopf.click();
    await takt(30);
    assert.equal(d.getElementById('gs').value, '');
    const neu = aufrufe.slice(vorher).find(a => a.url.includes('/v1/sets?'));
    assert.ok(neu, 'Die Sammlung wurde nicht neu geladen');
    assert.doesNotMatch(neu.url, /search=/);
  } finally { w.close(); }
});

test('Sammlung: Themenfilter ohne Treffer', async () => {
  const { w, d } = await oeffneOberflaeche(LEER);
  try {
    await warte(() => d.querySelector('#gtheme option[value="Icons"]'));
    d.getElementById('gtheme').value = 'Icons';
    d.getElementById('gtheme').dispatchEvent(new w.Event('change'));
    await warte(() => d.querySelector('#gallery .leer h3')?.textContent.includes('Filter'));
    assert.equal(d.querySelector('#gallery .leer h3').textContent, 'Keine Sets passen zu diesem Filter');
    assert.ok(d.querySelector('#gallery [data-click="filterZuruecksetzen"]'));
  } finally { w.close(); }
});

test('Merkliste: Suche ohne Treffer', async () => {
  const { w, d } = await oeffneOberflaeche({ '/v1/wanted': { success: true, merkposten: [] } });
  try {
    await reiter(w, 'wanted');
    d.getElementById('mks').value = 'xyz';
    d.getElementById('mks').dispatchEvent(new w.Event('input'));
    await warte(() => d.querySelector('#mk-list [data-click="filterZuruecksetzen"]'));
    d.querySelector('#mk-list [data-click="filterZuruecksetzen"]').click();
    await takt(30);
    assert.equal(d.getElementById('mks').value, '');
    await warte(() => !d.querySelector('#mk-list [data-click="filterZuruecksetzen"]'));
    assert.equal(d.querySelector('#mk-list [data-click="filterZuruecksetzen"]'), null, 'Nach dem Zurücksetzen steht weiter „nichts gefunden“');
  } finally { w.close(); }
});
