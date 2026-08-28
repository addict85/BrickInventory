/**
 * Flackern der Kachelwand nach dem Laden bzw. direkt nach dem Login.
 *
 * Ursache waren zwei Dinge, die zusammenwirkten:
 *
 *   1. loadGallery() rendert die Galerie, danach holt enrichGalleryWithPrices()
 *      asynchron die Preisdaten und rief anschliessend renderGallery() auf —
 *      ein kompletter innerHTML-Neuaufbau, nur um pro Kachel eine Zeile zu
 *      ergänzen.
 *   2. styles.css blendet Lazy-Bilder ein (opacity 0 → 1 über 250 ms). Nach dem
 *      Neuaufbau sind alle <img> neue Elemente und starten wieder bei 0 — auch
 *      bei warmem Cache. Die .loaded-Klasse kam ausschliesslich aus dem
 *      IntersectionObserver-Callback, und der ist asynchron.
 *
 * Ergebnis: die ganze Kachelwand wurde für einen Moment weiss.
 *
 * Ohne DOM testbar, weil beide Fixes strukturell sind. Ausführen: npm test
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

const PUB = path.join(__dirname, '..', 'public');
const core    = stripModuleSyntax(require('./helpers/sources').coreQuelle());
const gallery = stripModuleSyntax(fs.readFileSync(path.join(PUB, 'js', '02-gallery.js'), 'utf8'));
const admin   = stripModuleSyntax(require('./helpers/sources').adminQuelle());
const styles  = fs.readFileSync(path.join(PUB, 'styles.css'), 'utf8');

/**
 * Entfernt Zeilenkommentare vor einer Struktur-Prüfung.
 *
 * Ohne das schlagen Assertions auf Kommentartexten an, die den entfernten Code
 * nur BESCHREIBEN — der Kommentar "hier stand früher renderGallery()" würde eine
 * doesNotMatch-Prüfung auf renderGallery() fälschlich rot machen.
 */
function code(src) {
  return src.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
}

test('geladene Bilder werden synchron als loaded markiert', () => {
  const fn = core.slice(core.indexOf('function observeLazyImages'),
                        core.indexOf('function toast'));
  assert.match(fn, /complete && img\.naturalWidth > 0/,
    'Ohne synchrone Prüfung liegt zwischen innerHTML und Observer-Callback ' +
    'mindestens ein Paint mit unsichtbaren Bildern');
  // Die Prüfung muss VOR dem Observer-Setup stehen, sonst nützt sie nichts
  assert.ok(fn.indexOf('naturalWidth') < fn.indexOf('IntersectionObserver'),
    'Die synchrone Markierung muss vor dem Observer laufen');
});

test('beide Galerie-Ansichten beobachten ihre Bilder', () => {
  const calls = [...gallery.matchAll(/observeLazyImages\(c\)/g)];
  assert.equal(calls.length, 2,
    'Grid- UND Listenansicht müssen observeLazyImages() aufrufen — für die ' +
    'Listenansicht fehlte der Aufruf ganz');
});

test('Preisdaten lösen keinen kompletten Neuaufbau mehr aus', () => {
  const src = code(admin);
  // Ankertext angepasst: `_pnlCache = {}` ist mit den ES-Modulen zu
  // `set_pnlCache({})` geworden — importierte Bindungen sind schreibgeschützt,
  // deshalb der Setter (siehe js/02-gallery.js). Der geprüfte Sachverhalt ist
  // unverändert.
  const fn = src.slice(src.indexOf('set_pnlCache({})'), src.indexOf('function sparklineSVG'));
  assert.ok(fn.length > 0, 'Anker set_pnlCache({}) nicht gefunden — Prüfung liefe ins Leere');
  assert.doesNotMatch(fn, /renderGallery\(\)/,
    'enrichGalleryWithPrices() darf die Kachelwand nicht neu bauen — jedes <img> ' +
    'wäre danach ein neues Element und würde erneut einblenden');
  assert.match(fn, /updateGalleryPrices\(\)/,
    'Stattdessen nur die Preis-Container nachtragen');
});

test('die Preis-Zeile ist ein stabiler Anker', () => {
  assert.match(gallery, /data-price-for="/,
    'Ohne stabilen Anker lässt sich der Preis nicht einzeln nachtragen');
  assert.match(gallery, /function updateGalleryPrices/);
  // Immer im Markup, nur leer ausgeblendet — sonst gäbe es beim ersten
  // Preis-Update doch wieder ein Layout-Sprung
  assert.match(gallery, /data-price-for="\$\{esc\(s\.set_number\)\}"\$\{priceStr\|\|pnl \? '' : ' hidden'\}/,
    'Der Container muss immer gerendert und nur bei leerem Inhalt hidden sein');
  assert.match(styles, /\.price-badge\[hidden\]\{display:none\}/,
    '.price-badge setzt display:flex — ohne diese Regel bliebe [hidden] wirkungslos');
});
