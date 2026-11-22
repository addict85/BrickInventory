/**
 * The wishlist filter in the web app — with the same sortings as the server.
 *
 * Step 1 runs in the real bundle (jsdom); 3–4 compare the selection with the
 * server table WANTED_SORTS (structure).
 *
 * Counter-checks:
 *   a) qty_desc added to the web app's selection → step 3 red.
 *   d) (10.11.2026) addScopeParam removed from wanted.js → step 1 red.
 *   f) (10.11.2026) sorting not set in wantedParams → step 1 red.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./helpers/sources');
const ohneKommentare = (/** @type {string} */ s) => require('./helpers/sources').ohneKommentare(s);
const { openUi, reiter, warte } = require('./helpers/ui');

/** The sort values of a source — everything that looks like a WANTED_SORTS key. */
function sortValues(quelle) {
  return [...new Set(quelle.match(/\b(?:added|name|num|year|price|qty)_(?:asc|desc)\b/g) || [])].sort();
}

test('1. the web app sends all four filters to the server', async () => {
  const o = await openUi({
    '/v1/sets/household-members': {
      success: true,
      members: [
        { id: 1, username: 'anna', is_self: true, tiefe: 0 },
        { id: 7, username: 'ben', is_self: false, tiefe: 1 },
      ],
    },
    '/v1/wanted': { success: true, merkposten: [] },
  });
  try {
    await reiter(o.w, 'wanted');
    await o.ruhig();
    const setze = (id, wert) => {
      const f = o.d.getElementById(id);
      f.value = wert;
      assert.equal(f.value, wert, `${id} kennt ${wert} nicht`);
      f.dispatchEvent(new o.w.Event(f.tagName === 'INPUT' ? 'input' : 'change', { bubbles: true }));
    };
    setze('scope-wanted', '7');
    setze('mkcond', 'U');
    setze('mksort', 'price_asc');
    setze('mks', 'Burg');
    assert.ok(
      await warte(() => o.aufrufe.some(a => /\/v1\/wanted\?.*search=Burg/.test(a.url)), 2000),
      'die Suche lädt nicht neu',
    );
    await o.ruhig();
    const p = new URL(o.aufrufe.filter(a => /\/v1\/wanted\?/.test(a.url)).at(-1).url, 'http://x').searchParams;
    assert.deepEqual(
      [p.get('search'), p.get('condition'), p.get('sort'), p.get('accounts')],
      ['Burg', 'U', 'price_asc', '7'],
    );
  } finally {
    o.w.close();
  }
});

test('3. the web app offers exactly the sortings the server knows', () => {
  // ── The source of truth ───────────────────────────────────────────────────
  const server = ohneKommentare(fs.readFileSync(path.join(ROOT, 'src/wanted/repository/wanted.ts'), 'utf8'));
  const tabelle = server.slice(
    server.indexOf('const WANTED_SORTS'),
    server.indexOf('};', server.indexOf('const WANTED_SORTS')),
  );
  const erlaubt = sortValues(tabelle);
  assert.ok(erlaubt.length >= 5, `Nur ${erlaubt.length} Sortierwerte gefunden — Tabelle umbenannt?`);
  // qty_* explicitly does NOT belong to it: a wishlist item has no quantity.
  assert.ok(
    !erlaubt.some(w => w.startsWith('qty_')),
    'WANTED_SORTS führt eine Anzahl-Sortierung — ein Merkposten hat keine Anzahl.',
  );

  // ── Web app: the <option> values of the sort field ────────────────────────
  const html = ohneKommentare(fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8'));
  const feld = html.slice(html.indexOf('id="mksort"'));
  const webValues = sortValues(feld.slice(0, feld.indexOf('</select>')));
  assert.deepEqual(
    webValues,
    erlaubt,
    'Die Auswahl der Webapp und WANTED_SORTS gehen auseinander — ein unbekannter ' +
      'Wert fällt am Server still auf die Vorgabe zurück.',
  );
});

test('4. the default sorting is the same in server and web app', () => {
  // It decides whether the web app sends the parameter at all.
  const server = ohneKommentare(fs.readFileSync(path.join(ROOT, 'src/wanted/repository/wanted.ts'), 'utf8'));
  const firstRow = server.slice(server.indexOf('const WANTED_SORTS')).split('\n')[1];
  assert.match(firstRow, /added_desc/, 'WANTED_SORTS beginnt nicht mit added_desc');

  const html = ohneKommentare(fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8'));
  const feld = html.slice(html.indexOf('id="mksort"'));
  assert.match(
    feld.slice(0, 200),
    /<option value="added_desc"/,
    'Die Webapp hat eine andere Vorgabe — das erste <option> ist die Vorauswahl.',
  );
});
