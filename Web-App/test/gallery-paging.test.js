/**
 * Seitenweises Laden der Galerie (Punkt 4 der Optimierungsliste).
 *
 * Vorher holte `/sets` alle Sets samt aller Anleitungen, und der Browser
 * filterte und sortierte über das komplette Array. Beides zusammen geht mit
 * seitenweisem Laden nicht: Ein Filter hätte nur die geladene Seite durchsucht.
 * Filtern und Sortieren liegen deshalb jetzt auf dem Server.
 *
 * Ohne `page_size` verhält sich der Endpunkt wie bisher — die Android-App ruft
 * ihn so auf und bleibt unverändert lauffähig.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * import-/export-Syntax aus einer Moduldatei entfernen.
 *
 * Diese Tests werten den Quelltext in einer vm-Sandbox bzw. in jsdom als
 * KLASSISCHES Skript aus. Seit der Umstellung auf ES-Module enthalten die
 * Dateien import- und export-Anweisungen, die dort einen SyntaxError erzeugen
 * ("Cannot use import statement outside a module"). Die geprüfte Logik ändert
 * sich dadurch nicht — nur die Modulverpackung muss weg.
 *
 * @param {string} src
 * @returns {string}
 */
function stripModuleSyntax(src) {
  const body = src
    .replace(/^import[^;]*;\s*$/gm, '')   // import { a, b } from '…';
    .replace(/^export\s+/gm, '');          // export function/const/let/class
  // registerActions() kommt sonst aus js/00-registry.js und ist nach dem
  // Entfernen der Importe nicht definiert. In der Sandbox interessiert die
  // Anmeldung nicht — dass sie aufgerufen WIRD, prüfen test/csp-actions.test.js
  // und test/bundle-smoke.test.js gegen den echten Quelltext.
  // tRaw() lebt in i18n.js und wird hier nicht mitgeladen. In der Sandbox
  // genügt die Weiterleitung an t(): Der Unterschied liegt allein in der
  // Maskierung der eingesetzten Werte, die diese Tests nicht prüfen.
  return 'function registerActions() {}\n'
       + 'function tRaw(k, v) { return typeof t === "function" ? t(k, v) : k; }\n'
       + body;
}

const ROOT = path.join(__dirname, '..');
const H_SRC = require('./helpers/sources').handlerQuelle();
const GAL   = stripModuleSyntax(fs.readFileSync(path.join(ROOT, 'public', 'js', '02-gallery.js'), 'utf8'));
const HTML  = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

test('die Sortierung ist eine Whitelist, kein interpolierter Parameter', () => {
  assert.match(H_SRC, /const SET_SORTS = \{/,
    'Ohne Whitelist landet der Wert eines <select> ungeprüft in der ORDER BY-Klausel');
  assert.match(H_SRC, /SET_SORTS\[sort\] \|\| SET_SORTS\.added_desc/,
    'Unbekannte Werte müssen auf die Vorgabe fallen');
  // Der Suchbegriff gehört als Parameter gebunden, nicht in den String
  const fn = H_SRC.slice(H_SRC.indexOf('async function getSets'), H_SRC.indexOf('async function getSetConditionAggregate'));
  assert.match(fn, /params\.push\(`%\$\{String\(search\)\.toLowerCase\(\)\}%`\)/,
    'Der Suchbegriff muss als Parameter gebunden werden');
});

test('ohne page_size bleibt alles wie bisher', () => {
  const fn = H_SRC.slice(H_SRC.indexOf('async function getSets'), H_SRC.indexOf('async function getSetConditionAggregate'));
  assert.match(fn, /if \(page_size\) \{/, 'LIMIT darf nur bei gesetztem page_size greifen');
  assert.match(fn, /page_size \? db\.get\(/, 'der Zähler kostet sonst unnötig Zeit');
  // Der Test pinnte hier den Wortlaut eines Kommentars („Android-App sendet
  // kein page_size"). Der stimmt nicht mehr: Seit Marcos Vorgabe blättert auch
  // die App seitenweise. Geprüft wird jetzt die AUSSAGE — der Endpunkt reicht
  // alle vier Parameter durch, und ohne page_size bleibt die Liste unbegrenzt.
  const v1 = fs.readFileSync(path.join(ROOT, 'routes', 'api_v1', 'sets.ts'), 'utf8');
  const route = v1.slice(v1.indexOf("router.get('/sets', requireToken"), v1.indexOf("router.get('/sets/:setNumber'"));
  assert.match(route, /const \{ search, theme, sort, page, page_size \} = req\.query;/,
    'Die Route muss alle Filterparameter durchreichen — sonst filtert der Client wieder selbst');
});

test('die Themenliste kommt vom Server und nur auf Seite 1', () => {
  assert.match(H_SRC, /SELECT DISTINCT theme FROM sets/,
    'Aus der geladenen Seite abgeleitet wäre das Auswahlfeld unvollständig');
  assert.match(H_SRC, /parseInt\(page\) <= 1/, 'Folgeseiten brauchen die Liste nicht');
  assert.match(GAL, /Array\.isArray\(d\.themes\)/, 'Der Client muss die Serverliste verwenden');
  assert.match(GAL, /esc\(th\)/, 'Themennamen stammen aus Fremddaten und müssen escaped werden');
});

test('renderGallery filtert und sortiert nicht mehr selbst', () => {
  const fn = GAL.slice(GAL.indexOf('function renderGallery()'), GAL.indexOf('function updateGalleryPrices'));
  assert.doesNotMatch(fn, /allSets\.filter/, 'ein Clientfilter sähe nur die geladene Seite');
  assert.doesNotMatch(fn, /list\.sort\(/, 'Sortieren über eine Teilmenge ergibt eine falsche Reihenfolge');
});

test('Suche, Sortierung und Themenfilter lösen einen Neuaufbau aus', () => {
  assert.match(GAL, /_t=setTimeout\(loadGallery,250\)/, 'Suche muss neu laden, nicht neu zeichnen');
  assert.match(GAL, /G\('gsort'\)\.addEventListener\('change',loadGallery\)/, 'Sortierung ebenso');
  assert.match(GAL, /themeEl\.addEventListener\('change', loadGallery\)/, 'Themenfilter ebenso');
});

test('Endlos-Scroll nach demselben Muster wie Katalog und Teile', () => {
  assert.match(GAL, /_galGen/, 'Generationszähler gegen späte Antworten');
  assert.match(GAL, /if \(gen !== _galGen\) return/, 'Antworten verworfener Filter dürfen nicht landen');
  assert.match(GAL, /rootMargin: '600px'/, 'ohne Vorlauf ruckelt das Nachladen');
  assert.match(GAL, /requestAnimationFrame\(maybeLoadMoreGallery\)/,
    'füllt die erste Seite den Bildschirm nicht, gäbe es nie ein Scroll-Ereignis');
  const fn = GAL.slice(GAL.indexOf('function maybeLoadMoreGallery'));
  assert.match(fn.slice(0, 260), /tab-gallery[\s\S]{0,80}classList\.contains\('active'\)/,
    'sonst lädt der Sentinel im Hintergrund weiter');
});

test('der Sentinel steht neben #gallery, nicht darin', () => {
  const g = HTML.indexOf('id="gallery"');
  const sIdx = HTML.indexOf('id="gallery-sentinel"');
  assert.ok(g > 0 && sIdx > g, 'gallery-sentinel fehlt');
  assert.match(HTML.slice(g, sIdx), /<\/div>/,
    '#gallery wird bei jedem Filterwechsel ersetzt — der Observer verlöre sein Ziel');
});

test('Folgeseiten hängen an, statt alles neu zu bauen', () => {
  assert.match(GAL, /function appendGallery/, 'Anhängen fehlt');
  assert.match(GAL, /insertAdjacentHTML\('beforeend'/,
    'Ein renderGallery() je Seite würde alle Bilder neu laden lassen');
});

// ── Minifiguren und manuelle Listen ────────────────────────────────────────
const FIGS = stripModuleSyntax(fs.readFileSync(path.join(ROOT, 'public', 'js', '06-minifigs.js'), 'utf8'));

test('Minifiguren laden seitenweise', () => {
  assert.match(H_SRC, /async function getMinifigs\(userId, \{ search, source, set_number, page = 1, page_size = null \}/,
    'page/page_size fehlen in getMinifigs');
  assert.match(H_SRC, /SELECT 1 FROM minifigs m[\s\S]{0,220}GROUP BY LOWER\(TRIM\(m\.fig_number\)\), m\.source\) g/,
    'Der Zähler muss über die Gruppen laufen — eine Figur aus fünf Sets zählt sonst fünfmal');
  assert.match(FIGS, /_figGen/, 'Generationszähler fehlt');
  assert.match(FIGS, /rootMargin: '600px'/, 'Endlos-Scroll fehlt');
});

test('der Ausschluss manueller Figuren passiert auf dem Server', () => {
  assert.doesNotMatch(FIGS, /\.filter\(f => f\.source !== 'manual'\)/,
    'Clientseitig gefiltert könnte eine ganze Seite wegfallen und die Liste bliebe leer');
  assert.match(FIGS, /p\.set\('source', G\('fig-source'\)\?\.value \|\| 'set'\)/,
    'Die Quelle gehört als Parameter an den Server');
});

test('der Minifiguren-Filter lädt neu statt clientseitig zu filtern', () => {
  const fn = FIGS.slice(FIGS.indexOf('function filterFigs'), FIGS.indexOf('function filterFigs') + 400);
  assert.doesNotMatch(fn, /allFigsCache\.filter/, 'ein Clientfilter sähe nur die geladene Seite');
  assert.match(fn, /loadMinifigs\(\)/, 'der Filter muss einen Neuaufbau auslösen');
});

test('auch die manuellen Listen können seitenweise', () => {
  for (const f of ['getManualParts', 'getManualMinifigs']) {
    const fn = H_SRC.slice(H_SRC.indexOf(`async function ${f}(`), H_SRC.indexOf(`async function ${f}(`) + 900);
    assert.match(fn, /page_size/, `${f} kennt kein page_size`);
    assert.match(fn, /LIMIT \$\$\{params\.length - 1\} OFFSET \$\$\{params\.length\}/,
      `${f}: LIMIT/OFFSET müssen gebunden werden, nicht interpoliert`);
  }
});

test('die Sentinels stehen jeweils neben ihrer Liste', () => {
  const l = HTML.indexOf('id="figs-list"');
  const sIdx = HTML.indexOf('id="figs-sentinel"');
  assert.ok(l > 0 && sIdx > l, 'figs-sentinel fehlt');
  assert.match(HTML.slice(l, sIdx), /<\/div>/, 'der Sentinel darf nicht in #figs-list liegen');
});

test('nach Anzahl lässt sich in beide Richtungen sortieren', () => {
  // ── Warum ein zweiter Sortierschlüssel nötig ist ──────────────────────────
  // Die allermeisten Sets stehen mit genau einem Exemplar im Bestand. Ohne
  // festen Zweitschlüssel wäre die Reihenfolge innerhalb dieser grossen Gruppe
  // von Postgres nicht definiert — und weil die Galerie seitenweise lädt,
  // könnte dasselbe Set beim Blättern zweimal oder gar nicht erscheinen. Das
  // ist dieselbe Falle wie bei jeder anderen nicht eindeutigen Sortierung.
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
