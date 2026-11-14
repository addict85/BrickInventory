/**
 * Der Filter der Merkliste in der Webapp — mit denselben Sortierungen wie der Server.
 *
 * Schritt 1 läuft im echten Bündel (jsdom); 3–4 gleichen die Auswahl mit der
 * Servertabelle MERK_SORTS ab (Struktur).
 *
 * Gegenproben:
 *   a) qty_desc in die Auswahl der Webapp aufgenommen → Schritt 3 rot.
 *   d) (10.11.2026) addScopeParam aus merkliste.js entfernt → Schritt 1 rot.
 *   f) (10.11.2026) in merklisteParams die Sortierung nicht gesetzt → Schritt 1 rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./helpers/sources');
const ohneKommentare = (/** @type {string} */ s) => require('./helpers/sources').ohneKommentare(s);
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

/** Die Sortierwerte einer Quelle — alles, was wie ein MERK_SORTS-Schlüssel aussieht. */
function sortWerte(quelle) {
  return [...new Set(quelle.match(/\b(?:added|name|num|year|price|qty)_(?:asc|desc)\b/g) || [])].sort();
}

test('1. die Webapp schickt alle vier Filter an den Server', async () => {
  const o = await oeffneOberflaeche({
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
    setze('scope-merkliste', '7');
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

test('3. die Webapp bietet genau die Sortierungen an, die der Server kennt', () => {
  // ── Die Quelle der Wahrheit ───────────────────────────────────────────────
  const server = ohneKommentare(fs.readFileSync(path.join(ROOT, 'src/merkliste/repository/merkliste.ts'), 'utf8'));
  const tabelle = server.slice(
    server.indexOf('const MERK_SORTS'),
    server.indexOf('};', server.indexOf('const MERK_SORTS')),
  );
  const erlaubt = sortWerte(tabelle);
  assert.ok(erlaubt.length >= 5, `Nur ${erlaubt.length} Sortierwerte gefunden — Tabelle umbenannt?`);
  // qty_* gehört ausdrücklich NICHT dazu: Ein Merkposten hat keine Anzahl.
  assert.ok(
    !erlaubt.some(w => w.startsWith('qty_')),
    'MERK_SORTS führt eine Anzahl-Sortierung — ein Merkposten hat keine Anzahl.',
  );

  // ── Webapp: die <option>-Werte des Sortierfelds ───────────────────────────
  const html = ohneKommentare(fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8'));
  const feld = html.slice(html.indexOf('id="mksort"'));
  const webWerte = sortWerte(feld.slice(0, feld.indexOf('</select>')));
  assert.deepEqual(
    webWerte,
    erlaubt,
    'Die Auswahl der Webapp und MERK_SORTS gehen auseinander — ein unbekannter ' +
      'Wert fällt am Server still auf die Vorgabe zurück.',
  );
});

test('4. die Vorgabe-Sortierung ist in Server und Webapp dieselbe', () => {
  // Sie entscheidet, ob die Webapp den Parameter überhaupt mitschickt.
  const server = ohneKommentare(fs.readFileSync(path.join(ROOT, 'src/merkliste/repository/merkliste.ts'), 'utf8'));
  const ersteZeile = server.slice(server.indexOf('const MERK_SORTS')).split('\n')[1];
  assert.match(ersteZeile, /added_desc/, 'MERK_SORTS beginnt nicht mit added_desc');

  const html = ohneKommentare(fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8'));
  const feld = html.slice(html.indexOf('id="mksort"'));
  assert.match(
    feld.slice(0, 200),
    /<option value="added_desc"/,
    'Die Webapp hat eine andere Vorgabe — das erste <option> ist die Vorauswahl.',
  );
});
