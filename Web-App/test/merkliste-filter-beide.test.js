/**
 * Der Filter der Merkliste steht in BEIDEN Oberflächen — und beide bieten
 * dieselben Sortierungen an wie der Server.
 * Ausführlich: docs/begruendungen/test/merkliste-filter-beide.test.js.md#kopf
 *
 * Schritt 1 läuft im echten Bündel (jsdom); 2–4 gleichen die Auswahl der
 * Oberflächen mit der Servertabelle MERK_SORTS ab (Struktur, App ohne SDK).
 *
 * Gegenproben:
 *   a) qty_desc in die Auswahl der Webapp aufgenommen → Schritt 3 rot.
 *   b) price_asc aus der App-Auswahl entfernt         → Schritt 3 rot.
 *   c) accounts aus der App-Abfrage entfernt          → Schritt 2 rot.
 *   d) (10.11.2026) addScopeParam aus 16-merkliste.js entfernt → Schritt 1 rot.
 *   e) Das Suchfeld aus MerklisteScreen entfernt      → Schritt 2 rot.
 *   f) (10.11.2026) in merklisteParams die Sortierung nicht gesetzt → Schritt 1 rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./helpers/sources');
const ohneKommentare = (/** @type {string} */ s) => require('./helpers/sources').ohneKommentare(s);
const { androidDatei } = require('./helpers/android');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

// Die App-Quellen über alle Module: androidDatei() meldet eine fehlende Datei mit Namen.

const app = (rel) => ohneKommentare(fs.readFileSync(androidDatei(rel), 'utf8'));

/** Die Sortierwerte einer Quelle — alles, was wie ein MERK_SORTS-Schlüssel aussieht. */
function sortWerte(quelle) {
  return [...new Set((quelle.match(/\b(?:added|name|num|year|price|qty)_(?:asc|desc)\b/g) || []))].sort();
}

test('1. die Webapp schickt alle vier Filter an den Server', async () => {
  const o = await oeffneOberflaeche({
    '/v1/sets/household-members': { success: true, members: [
      { id: 1, username: 'anna', is_self: true, tiefe: 0 }, { id: 7, username: 'ben', is_self: false, tiefe: 1 }] },
    '/v1/wanted': { success: true, merkposten: [] },
  });
  try {
    await reiter(o.w, 'wanted');
    await o.ruhig();
    const setze = (id, wert) => { const f = o.d.getElementById(id); f.value = wert; assert.equal(f.value, wert, `${id} kennt ${wert} nicht`);
      f.dispatchEvent(new o.w.Event(f.tagName === 'INPUT' ? 'input' : 'change', { bubbles: true })); };
    setze('scope-merkliste', '7');
    setze('mkcond', 'U');
    setze('mksort', 'price_asc');
    setze('mks', 'Burg');
    assert.ok(await warte(() => o.aufrufe.some(a => /\/v1\/wanted\?.*search=Burg/.test(a.url)), 2000), 'die Suche lädt nicht neu');
    await o.ruhig();
    const p = new URL(o.aufrufe.filter(a => /\/v1\/wanted\?/.test(a.url)).at(-1).url, 'http://x').searchParams;
    assert.deepEqual([p.get('search'), p.get('condition'), p.get('sort'), p.get('accounts')], ['Burg', 'U', 'price_asc', '7']);
  } finally { o.w.close(); }
});

test('2. die App hat dieselben vier', () => {
  // Der Weg zum Server: vier Anfrageparameter, dieselben Namen wie in der
  // Webapp und am Server.
  const api = ohneKommentare(require('../scripts/kotlin-vertrag.js').apiQuelltext(path.join(__dirname, '..', '..', 'Android-App', 'core-data', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'data', 'api')));
  const abschnitt = api.slice(api.indexOf('suspend fun getMerkliste('));
  for (const p of ['search', 'condition', 'sort', 'accounts']) {
    assert.match(abschnitt.slice(0, 600), new RegExp(`@Query\\("${p}"\\)`),
      `getMerkliste() schickt ${p} nicht mit.`);
  }

  // Und die Bedienung: Kontofilter, Suchfeld, Sortierung, Zustand.
  const schirm = app('sammlung/ui/screens/MerklisteScreen.kt');
  assert.match(schirm, /ScopeFilterZeile\(/, 'Der App fehlt der Kontofilter in der Merkliste.');
  assert.match(schirm, /Suchfeld\(/,         'Der App fehlt das Suchfeld in der Merkliste.');
  assert.match(schirm, /setzeMerklisteSortierung\(/, 'Der App fehlt die Sortierung.');
  assert.match(schirm, /setzeMerklisteZustand\(/,    'Der App fehlt der Zustandsfilter.');
  assert.match(schirm, /filter_condition_all/,
    'Dem Zustandsfilter fehlt die Antwort „beide" — ein Filter hat immer eine.');

  // Die fünfte Ansicht im Aufzählungstyp: Ohne sie gäbe es keinen Schlüssel,
  // unter dem die Wahl gespeichert würde.
  assert.match(app('model/data/ScopeFilter.kt'), /MERKLISTE\("merkliste"\)/,
    'ScopeFilter.View kennt die Merkliste nicht.');
});

test('3. beide Oberflächen bieten genau die Sortierungen an, die der Server kennt', () => {
  // ── Die Quelle der Wahrheit ───────────────────────────────────────────────
  const server = ohneKommentare(fs.readFileSync(path.join(ROOT, 'src/merkliste/repository/merkliste.ts'), 'utf8'));
  const tabelle = server.slice(server.indexOf('const MERK_SORTS'), server.indexOf('};', server.indexOf('const MERK_SORTS')));
  const erlaubt = sortWerte(tabelle);
  assert.ok(erlaubt.length >= 5, `Nur ${erlaubt.length} Sortierwerte gefunden — Tabelle umbenannt?`);
  // qty_* gehört ausdrücklich NICHT dazu: Ein Merkposten hat keine Anzahl.
  assert.ok(!erlaubt.some(w => w.startsWith('qty_')),
    'MERK_SORTS führt eine Anzahl-Sortierung — ein Merkposten hat keine Anzahl.');

  // ── Webapp: die <option>-Werte des Sortierfelds ───────────────────────────
  const html = ohneKommentare(fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8'));
  const feld = html.slice(html.indexOf('id="mksort"'));
  const webWerte = sortWerte(feld.slice(0, feld.indexOf('</select>')));
  assert.deepEqual(webWerte, erlaubt,
    'Die Auswahl der Webapp und MERK_SORTS gehen auseinander — ein unbekannter ' +
    'Wert fällt am Server still auf die Vorgabe zurück.');

  // ── App: die Liste im DropdownMenu ────────────────────────────────────────
  const schirm = app('sammlung/ui/screens/MerklisteScreen.kt');
  const liste = schirm.slice(schirm.indexOf('listOf("added_desc"'));
  const appWerte = sortWerte(liste.slice(0, liste.indexOf(')')));
  assert.deepEqual(appWerte, erlaubt,
    'Die Auswahl der App und MERK_SORTS gehen auseinander.');
});

test('4. die Vorgabe-Sortierung ist in allen drei Bäumen dieselbe', () => {
  // Sie entscheidet, ob der Chip in der App als „gesetzt" gezeichnet wird, und
  // ob die Webapp den Parameter überhaupt mitschickt. Drei verschiedene
  // Vorgaben hiessen: dieselbe Liste, drei Reihenfolgen.
  const server = ohneKommentare(fs.readFileSync(path.join(ROOT, 'src/merkliste/repository/merkliste.ts'), 'utf8'));
  const ersteZeile = server.slice(server.indexOf('const MERK_SORTS')).split('\n')[1];
  assert.match(ersteZeile, /added_desc/, 'MERK_SORTS beginnt nicht mit added_desc');

  const html = ohneKommentare(fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8'));
  const feld = html.slice(html.indexOf('id="mksort"'));
  assert.match(feld.slice(0, 200), /<option value="added_desc"/,
    'Die Webapp hat eine andere Vorgabe — das erste <option> ist die Vorauswahl.');

  assert.match(app('data/repository/Ergebnis.kt'),
    /MERKLISTE_DEFAULT_SORT = "added_desc"/,
    'Die App hat eine andere Vorgabe.');
});
