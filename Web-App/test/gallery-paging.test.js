/**
 * Seitenweise Listen am Server: Sortier-Whitelist, gebundene Parameter,
 * Themenliste, Zähler. Ohne page_size liefert /sets alles (Android-App).
 * Das Verhalten der Oberfläche prüft test/listen-paging-oberflaeche.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const H_SRC = require('./helpers/sources').handlerQuelle();

test('die Sortierung ist eine Whitelist, kein interpolierter Parameter', () => {
  assert.match(H_SRC, /const SET_SORTS = \{/,
    'Ohne Whitelist landet der Wert eines <select> ungeprüft in der ORDER BY-Klausel');
  // Geprüft wird die AUSSAGE, nicht der Wortlaut.
  // Ausführlich: docs/begruendungen/test/gallery-paging.test.js.md#ohnekommentare
  const ohneKommentare = H_SRC.split('\n')
    .filter(z => !z.trim().startsWith('//') && !z.trim().startsWith('*'))
    .join('\n');
  assert.ok(!/SET_SORTS\s*\[/.test(ohneKommentare),
    'SET_SORTS darf nicht direkt indiziert werden — geerbte Eigenschaften kämen sonst durch');
  assert.match(ohneKommentare, /ausTabelle\(\s*SET_SORTS\s*,\s*sort\s*,\s*SET_SORTS\.added_desc\s*\)/,
    'Unbekannte Werte müssen auf die Vorgabe fallen');
  // Der Suchbegriff gehört als Parameter gebunden, nicht in den String
  const fn = require('./helpers/sources').funktionsRumpf(H_SRC, 'setListe');
  assert.match(fn, /params\.push\(enthaeltMuster\(String\(search\)\.toLowerCase\(\)\)\)/,
    'Der Suchbegriff muss als Parameter gebunden werden');
});

test('ohne page_size bleibt alles wie bisher', () => {
  // Die Seite rechnet getSets aus page_size; ohne sie ist f.seite null.
  const fn = require('./helpers/sources').funktionsRumpf(H_SRC, 'setListe');
  assert.match(fn, /if \(f\.seite\) \{/, 'LIMIT darf nur bei gesetztem page_size greifen');
  assert.match(fn, /f\.seite \? db\.get(?:<[^>]*>)?\(/, 'der Zähler kostet sonst unnötig Zeit');
  assert.match(require('./helpers/sources').funktionsRumpf(H_SRC, 'getSets'), /const size = page_size \?/);
  // Der Test pinnte hier den Wortlaut eines Kommentars („Android-App sendet
  // kein page_size"). Der stimmt nicht mehr: Seit Marcos Vorgabe blättert auch
  // die App seitenweise. Geprüft wird jetzt die AUSSAGE — der Endpunkt reicht
  // alle vier Parameter durch, und ohne page_size bleibt die Liste unbegrenzt.
  const v1 = fs.readFileSync(path.join(ROOT, 'routes/api_v1/sets.ts'), 'utf8');
  const route = v1.slice(v1.indexOf("router.get('/sets', requireToken"), v1.indexOf("router.get('/sets/:setNumber'"));
  // Die geprüfte Abfrage als GANZES: Eine Auswahl daneben liess einst `storage` fallen.
  assert.match(route, /await getSets\([^;]*\breq\.abfrage\)/,
    'Die Route muss alle Filterparameter durchreichen — sonst filtert der Client wieder selbst');
});

test('die Themenliste kommt vom Server und nur auf Seite 1', () => {
  // Die Abfrage las bis Migration 0033 `SELECT DISTINCT theme FROM sets`. Das
  // Thema steht jetzt im Katalog, also braucht sie einen JOIN — geprüft wird
  // weiterhin die AUSSAGE: über den ganzen Bestand des Kontos, nicht über die
  // geladene Seite.
  assert.match(H_SRC, /SELECT DISTINCT c\.theme AS theme\s*\n\s*FROM sets s JOIN set_catalog c/,
    'Aus der geladenen Seite abgeleitet wäre das Auswahlfeld unvollständig');
  assert.match(H_SRC, /WHERE s\.user_id = ANY\(\$1\) AND c\.theme IS NOT NULL/,
    'Die Themenliste muss auf das Blickfeld eingeschränkt sein');
  assert.match(H_SRC, /parseInt\(page\) <= 1/, 'Folgeseiten brauchen die Liste nicht');
});

// ── Minifiguren und manuelle Listen ────────────────────────────────────────
test('Minifiguren laden seitenweise', () => {
  // Auf die Parameter geprüft, nicht auf den Wortlaut des Kopfes: Eine
  // Typannotation an userId sagt über das Blättern nichts. Derselbe Fall wie
  // in einer früheren Runde — dort brachen fünf solcher Muster, ohne dass sich am
  // Verhalten etwas geändert hatte.
  const { funktionsKopf } = require('./helpers/sources');
  const figKopf = funktionsKopf(H_SRC, 'getMinifigs');
  for (const p of ['userId', 'search', 'source', 'set_number', 'page', 'page_size']) {
    // userId heisst seit dem 05.11.2026 userIdWahl (Sicht oder IDs).
    assert.match(figKopf, new RegExp(`\\b${p}(Wahl)?\\b`),
      `getMinifigs nimmt '${p}' nicht mehr entgegen: ${figKopf}`);
  }
  assert.match(figKopf, /page\s*=\s*1/,   'page muss auf 1 vorbelegt sein');
  assert.match(figKopf, /page_size\s*=\s*null/,
    'Ohne page_size-Vorgabe null könnte ein Aufrufer ungewollt blättern');
  assert.match(H_SRC, /SELECT 1 FROM minifigs m[\s\S]{0,220}GROUP BY LOWER\(TRIM\(m\.fig_number\)\), m\.source\) g/,
    'Der Zähler muss über die Gruppen laufen — eine Figur aus fünf Sets zählt sonst fünfmal');
});

test('auch die manuellen Listen können seitenweise', () => {
  // Der Rumpf GANZ, nicht die ersten 900 Zeichen (20.10., GEMESSEN)
  // Ausführlich: docs/begruendungen/test/gallery-paging.test.js.md#stelle
  const { funktionsRumpf } = require('./helpers/sources');
  for (const [f, liste] of [['getManualParts', 'manuelleTeile'], ['getManualMinifigs', 'manuelleFigurenListe']]) {
    assert.match(funktionsRumpf(H_SRC, f), /page_size/, `${f} kennt kein page_size`);
    const fn = funktionsRumpf(H_SRC, liste);
    assert.match(fn, /LIMIT \$\$\{params\.length - 1\} OFFSET \$\$\{params\.length\}/,
      `${f}: LIMIT/OFFSET müssen gebunden werden, nicht interpoliert`);
  }
});

test('nach Anzahl lässt sich in beide Richtungen sortieren', () => {
  // Warum ein zweiter Sortierschlüssel nötig ist
  // Ausführlich: docs/begruendungen/test/gallery-paging.test.js.md#handlers
  const handlers = require('./helpers/sources').handlerQuelle();
  const sorts = handlers.slice(handlers.indexOf('const SET_SORTS'),
                               handlers.indexOf('};', handlers.indexOf('const SET_SORTS')));
  assert.match(sorts, /qty_desc:\s*'s\.quantity DESC, s\.added_at DESC'/,
    'Absteigend nach Anzahl fehlt oder hat keinen Zweitschlüssel');
  assert.match(sorts, /qty_asc:\s*'s\.quantity ASC, s\.added_at DESC'/,
    'Aufsteigend nach Anzahl fehlt oder hat keinen Zweitschlüssel');

  // Die Auswahl im Markup muss zu den Schlüsseln passen — ein Tippfehler
  // dort fällt sonst erst auf, wenn der Server still auf added_desc zurückfällt.
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const select = html.slice(html.indexOf('id="gsort"'), html.indexOf('</select>', html.indexOf('id="gsort"')));
  for (const key of ['qty_desc', 'qty_asc']) {
    assert.ok(select.includes(`value="${key}"`), `Option ${key} fehlt in der Auswahl`);
  }

  // Jede Option braucht eine Übersetzung in BEIDEN Sprachen.
  const { loadTranslations } = require('./helpers/sources');
  const dict = loadTranslations();
  for (const key of ['gallery.sort.qty_desc', 'gallery.sort.qty_asc']) {
    assert.ok(dict.de[key], `${key} fehlt in de`);
    assert.ok(dict.en[key], `${key} fehlt in en`);
  }
});
