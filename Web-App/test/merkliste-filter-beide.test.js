/**
 * Der Filter der Merkliste steht in BEIDEN Oberflächen — und beide bieten
 * dieselben Sortierungen an wie der Server.
 *
 * ── Marcos Vorgaben vom 24.09. ──────────────────────────────────────────────
 *
 *   „In der Merkliste noch einen Filter analog den Sets einbauen inkl.
 *    Inhaber."
 *
 *   „Den Filter in der Merkliste sowohl in der Webapp als auch in der Android
 *    App einbauen."
 *
 * Die zweite ist der Grund für diese Datei. Das Muster, das diesen Baum
 * durchzieht: Eine Änderung landet in einer der beiden Oberflächen, die andere
 * bleibt zurück. Diese Prüfung liest beide Quellbäume und verlangt dasselbe
 * von beiden.
 *
 * ── Was sie zusätzlich prüft, und warum ─────────────────────────────────────
 *
 * Die Liste der SORTIERWERTE steht dreimal: in MERK_SORTS am Server, im
 * <select> der Webapp und in der Chip-Auswahl der App. Ein Wert, den eine
 * Oberfläche anbietet und der Server nicht kennt, fällt still auf die Vorgabe
 * zurück — die Auswahl täte dann nichts, ohne eine Fehlermeldung. Genau diese
 * Art von stiller Wirkungslosigkeit ist in diesem Baum schon mehrfach
 * vorgekommen, deshalb werden die drei Listen hier gegeneinander gehalten.
 *
 * Gelesen wird OHNE Kommentarzeilen: Sonst genügte ein Absatz, der einen Wert
 * ERKLÄRT, und die Regel hielte ihn für vorhanden.
 *
 * ── Gegenproben (durchgeführt, Ergebnis im Commit) ──────────────────────────
 *   a) qty_desc in die Auswahl der Webapp aufgenommen → Schritt 3 rot.
 *   b) price_asc aus der App-Auswahl entfernt         → Schritt 3 rot.
 *   c) accounts aus der App-Abfrage entfernt          → Schritt 2 rot.
 *   d) addScopeParam aus 16-merkliste.js entfernt     → Schritt 1 rot.
 *   e) Das Suchfeld aus MerklisteScreen entfernt      → Schritt 2 rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, ohneKommentare } = require('./helpers/sources');

// Als EIN Pfad und nicht als acht Segmente: test/baumbruecken.test.js zählt
// die Brücken zwischen den beiden Bäumen und will sie lesen können.
const APP = path.join(ROOT, '../Android-App/app/src/main/java/ch/brickinventoryapp');

const web = (rel) => ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const app = (rel) => ohneKommentare(fs.readFileSync(path.join(APP, rel), 'utf8'));

/** Die Sortierwerte einer Quelle — alles, was wie ein MERK_SORTS-Schlüssel aussieht. */
function sortWerte(quelle) {
  return [...new Set((quelle.match(/\b(?:added|name|num|year|price|qty)_(?:asc|desc)\b/g) || []))].sort();
}

test('1. die Webapp hat alle vier Filter', () => {
  const html = ohneKommentare(fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8'));
  // Suche, Zustand, Sortierung — und der Inhaber als dasselbe Auswahlfeld wie
  // in den vier anderen Ansichten.
  for (const id of ['mks', 'mkcond', 'mksort', 'scope-merkliste']) {
    assert.match(html, new RegExp(`id="${id}"`),
      `Der Merkliste fehlt das Filterfeld ${id}.`);
  }

  const js = web('public/js/16-merkliste.js');
  for (const p of ['search', 'condition', 'sort']) {
    assert.match(js, new RegExp(`p\\.set\\('${p}'`), `Die Webapp schickt ${p} nicht mit.`);
  }
  assert.match(js, /addScopeParam\(p, 'merkliste'\)/,
    'Die Webapp schickt den Inhaber nicht mit.');

  // Die fünfte Ansicht muss in der Liste stehen, sonst füllt initScopeSelects()
  // das Auswahlfeld nie — es bliebe für immer verborgen.
  assert.match(web('public/js/14-scope.js'),
    /SCOPE_VIEWS = \['gallery', 'parts', 'minifigs', 'finance', 'merkliste'\]/,
    "'merkliste' fehlt in SCOPE_VIEWS.");
});

test('2. die App hat dieselben vier', () => {
  // Der Weg zum Server: vier Anfrageparameter, dieselben Namen wie in der
  // Webapp und am Server.
  const api = app('data/api/BrickApiService.kt');
  const abschnitt = api.slice(api.indexOf('suspend fun getMerkliste('));
  for (const p of ['search', 'condition', 'sort', 'accounts']) {
    assert.match(abschnitt.slice(0, 600), new RegExp(`@Query\\("${p}"\\)`),
      `getMerkliste() schickt ${p} nicht mit.`);
  }

  // Und die Bedienung: Kontofilter, Suchfeld, Sortierung, Zustand.
  const schirm = app('ui/screens/MerklisteScreen.kt');
  assert.match(schirm, /ScopeFilterZeile\(/, 'Der App fehlt der Kontofilter in der Merkliste.');
  assert.match(schirm, /Suchfeld\(/,         'Der App fehlt das Suchfeld in der Merkliste.');
  assert.match(schirm, /setzeMerklisteSortierung\(/, 'Der App fehlt die Sortierung.');
  assert.match(schirm, /setzeMerklisteZustand\(/,    'Der App fehlt der Zustandsfilter.');
  assert.match(schirm, /filter_condition_all/,
    'Dem Zustandsfilter fehlt die Antwort „beide" — ein Filter hat immer eine.');

  // Die fünfte Ansicht im Aufzählungstyp: Ohne sie gäbe es keinen Schlüssel,
  // unter dem die Wahl gespeichert würde.
  assert.match(app('data/ScopeFilter.kt'), /MERKLISTE\("merkliste"\)/,
    'ScopeFilter.View kennt die Merkliste nicht.');
});

test('3. beide Oberflächen bieten genau die Sortierungen an, die der Server kennt', () => {
  // ── Die Quelle der Wahrheit ───────────────────────────────────────────────
  const server = ohneKommentare(fs.readFileSync(path.join(ROOT, 'utils/merkliste.ts'), 'utf8'));
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
  const schirm = app('ui/screens/MerklisteScreen.kt');
  const liste = schirm.slice(schirm.indexOf('listOf("added_desc"'));
  const appWerte = sortWerte(liste.slice(0, liste.indexOf(')')));
  assert.deepEqual(appWerte, erlaubt,
    'Die Auswahl der App und MERK_SORTS gehen auseinander.');
});

test('4. die Vorgabe-Sortierung ist in allen drei Bäumen dieselbe', () => {
  // Sie entscheidet, ob der Chip in der App als „gesetzt" gezeichnet wird, und
  // ob die Webapp den Parameter überhaupt mitschickt. Drei verschiedene
  // Vorgaben hiessen: dieselbe Liste, drei Reihenfolgen.
  const server = ohneKommentare(fs.readFileSync(path.join(ROOT, 'utils/merkliste.ts'), 'utf8'));
  const ersteZeile = server.slice(server.indexOf('const MERK_SORTS')).split('\n')[1];
  assert.match(ersteZeile, /added_desc/, 'MERK_SORTS beginnt nicht mit added_desc');

  const html = ohneKommentare(fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8'));
  const feld = html.slice(html.indexOf('id="mksort"'));
  assert.match(feld.slice(0, 200), /<option value="added_desc"/,
    'Die Webapp hat eine andere Vorgabe — das erste <option> ist die Vorauswahl.');

  assert.match(app('data/repository/BrickRepository.kt'),
    /MERKLISTE_DEFAULT_SORT = "added_desc"/,
    'Die App hat eine andere Vorgabe.');
});
