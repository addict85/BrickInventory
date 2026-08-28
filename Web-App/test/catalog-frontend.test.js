/**
 * Frontend-Tests für public/js/09-catalog.js in jsdom (devDependency).
 *
 * ── Was sich geändert hat (Nachtrag 90) ─────────────────────────────────────
 * Dieser Test war ganz um den Von-Bis-Schieber gebaut. Den gibt es nicht mehr:
 * Marcos Vorgabe war, dass die Jahres-Leiste rechts SPRINGT statt zu filtern,
 * „analog wie es in der Android-Galerie-Foto-App der Fall ist" — und dass der
 * Schieber entsprechend entfallen kann.
 *
 * Damit ändert sich auch das Laden: Kein Endlos-Scroll mehr, der anhängt,
 * sondern ein Block je Seite über das GANZE Ergebnis; geladen wird der Block,
 * der ins Bild kommt — vorwärts wie rückwärts. Ohne das könnte ein Sprung
 * mitten in den Bestand nirgends landen.
 *
 * Geprüft wird jetzt genau das, plus: Der Jahresfilter über die beiden
 * Auswahlfelder bleibt (die Leiste ersetzt ihn NICHT), und der Sprung fragt
 * den Server statt selbst zu rechnen.
 *
 * Ausführen: npm test   (oder: node --test test/catalog-frontend.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

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

const CODE = stripModuleSyntax(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', '09-catalog.js'), 'utf8'));
const dom = new JSDOM(`<!doctype html><html><body>
  <input id="cat-search" />
  <select id="cat-theme"><option value=""></option></select>
  <select id="cat-year-from"><option value=""></option></select>
  <select id="cat-year-to"><option value=""></option></select>
  <select id="cat-sort"><option value="year_desc" selected></option></select>
  <div id="cat-count"></div>
  <div id="catalog-grid"></div>
  <div id="app-scrollbar" style="display:none"><div id="app-scrollbar-thumb"></div>
    <div id="app-scrollbar-label"></div></div>
  <div id="cat-modal"></div><button id="cat-m-add"></button>
</body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true });

const w = dom.window;

// ── Mini-Backend: gleiche Semantik wie der (getestete) Server ────────────────
const DATA = [];
for (let y = 2000; y <= 2026; y++) for (let k = 0; k < 3; k++)
  DATA.push({ set_number: `${y}${k}-1`, name: `Set ${y}-${k}`, year: y, theme_id: 1, theme_name: 'Star Wars', num_parts: 100, image_url: '', owned: false, owned_quantity: 0 });
for (let k = 0; k < 4; k++)
  DATA.push({ set_number: `900${k}-1`, name: `Future ${k}`, year: 2027, theme_id: 1, theme_name: 'Star Wars', num_parts: 500, image_url: '', owned: false, owned_quantity: 0 });

const requests = [];
function fakeApi(_method, url) {
  requests.push(url);
  if (url.startsWith('/v1/catalog/meta')) {
    const counts = {};
    for (const s of DATA) counts[s.year] = (counts[s.year] || 0) + 1;
    return Promise.resolve({
      success: true,
      themes: [{ id: 1, name: 'Star Wars', set_count: DATA.length }],
      year_min: 2000, year_max: 2027,
      year_counts: Object.entries(counts).map(([y, n]) => ({ year: +y, n })),
    });
  }
  if (url.startsWith('/v1/catalog/sets?')) {
    const p = new w.URLSearchParams(url.split('?')[1]);
    let rows = DATA.slice();
    if (p.get('q')) rows = rows.filter(s => s.name.includes(p.get('q')) || s.set_number.includes(p.get('q')));
    if (p.get('year_from')) rows = rows.filter(s => s.year >= parseInt(p.get('year_from')));
    if (p.get('year_to'))   rows = rows.filter(s => s.year <= parseInt(p.get('year_to')));
    const limit = parseInt(p.get('limit') || '60'), page = parseInt(p.get('page') || '1');
    return Promise.resolve({
      success: true, total: rows.length, page, pages: Math.max(1, Math.ceil(rows.length / limit)),
      sets: rows.slice((page - 1) * limit, page * limit),
    });
  }
  if (url.startsWith('/v1/catalog/year-verteilung')) {
    const p = new w.URLSearchParams((url.split('?')[1]) || '');
    const absteigend = p.get('sort') !== 'year_asc';
    const counts = {};
    for (const s of DATA) counts[s.year] = (counts[s.year] || 0) + 1;
    const years = Object.entries(counts).map(([y, n]) => ({ year: +y, n }))
      .sort((a, b) => absteigend ? b.year - a.year : a.year - b.year);
    return Promise.resolve({ success: true, years });
  }
  if (url.startsWith('/v1/catalog/year-offset?')) {
    // Dieselbe Regel wie der (eigens getestete) Server: Wie viele Sets stehen
    // VOR dem ersten dieses Jahres — in der Richtung der Sortierung.
    const p = new w.URLSearchParams(url.split('?')[1]);
    const jahr = parseInt(p.get('year'));
    const limit = parseInt(p.get('limit') || '60');
    const absteigend = p.get('sort') !== 'year_asc';
    const rows = DATA.slice().sort((a, b) => absteigend ? b.year - a.year : a.year - b.year);
    const offset = rows.findIndex(x => x.year === jahr);
    const o = offset < 0 ? rows.length - 1 : offset;
    return Promise.resolve({ success: true, offset: o, page: Math.floor(o / limit) + 1, total: rows.length });
  }
  return Promise.resolve({ success: false, error: 'unbekannt: ' + url });
}

// ── Globale Stubs, wie sie 01-core/i18n bereitstellen ────────────────────────
w.eval(`
  window.G = id => document.getElementById(id);
  window.t = (k, v) => { let s = k; if (v) for (const [a,b] of Object.entries(v)) s += ' ' + b; return s; };
  window.esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  window.locale = () => 'de-CH';
  window.toast = () => {};
  // Das Teile-Symbol kommt aus 02-gallery.js und wird hier nur als Marke
  // gebraucht: Der Test prüft die Katalog-Kachel, nicht das Bild darin.
  // Seit Nachtrag 89 steht es dort statt des Puzzleteil-Emojis.
  window.PARTS_ICON_SVG = '<svg data-test-parts-icon></svg>';
  // Den gemeinsamen Scrollbalken stellt js/01-core.js; hier zählt nur, DASS
  // der Katalog sein Etikett dort anmeldet.
  window.__scrollLabelFn = undefined;
  window.setScrollLabel = fn => { window.__scrollLabelFn = fn; };
`);
w.api = fakeApi;
// jsdom hat keinen IntersectionObserver — Stub fängt den Callback ab, damit
// der Test das Sichtbarwerden des Sentinels simulieren kann.
w.eval(`
  window.__ioCallbacks = [];
  window.IntersectionObserver = class {
    constructor(cb) { window.__ioCallbacks.push(cb); }
    observe() {} unobserve() {} disconnect() {}
  };
`);
// jsdom kennt scrollIntoView nicht (kein Layout). Für den Sprung zählt, WOHIN
// gescrollt würde — das hält der Stub fest.
w.eval(`
  window.__scrollZiele = [];
  Element.prototype.scrollIntoView = function () { window.__scrollZiele.push(this); };
`);
w.eval(CODE);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));
const problems = [];
const check = (name, cond, extra) => {
  if (!cond) problems.push(`${name}  ${extra !== undefined ? JSON.stringify(extra) : ''}`);
};
const lastSetsReq = () => requests.filter(u => u.includes('/catalog/sets?')).pop();
const hasYearFilter = u => /[?&]year_(from|to)=/.test(u);
const bloecke = () => w.document.querySelectorAll('#catalog-grid .cat-page');
const echteKacheln = () => w.document.querySelectorAll('#catalog-grid .sc:not(.cat-page-ph)').length;
const platzhalter = () => w.document.querySelectorAll('#catalog-grid .cat-page-ph').length;
/** Eine Seite ins Bild schieben — so, wie es der Beobachter meldet. */
const zeigeSeite = (n) => {
  const el = w.document.querySelector(`#catalog-grid .cat-page[data-page="${n}"]`);
  w.__ioCallbacks.forEach(cb => cb([{ isIntersecting: true, target: el }]));
};

test('Katalog-Frontend: Seitenblöcke, Jahresfilter, eigener Scrollbalken', async () => {
  w.eval('initCatalog()');
  await sleep(80);

  // ── Aufbau: ein Block je Seite über das GANZE Ergebnis ──────────────────
  check('Erste Anfrage OHNE Jahresfilter', !hasYearFilter(lastSetsReq()), lastSetsReq());
  check('85 Sets, also 2 Seitenblöcke', bloecke().length === 2, bloecke().length);

  // jsdom rechnet KEIN Layout: getBoundingClientRect() liefert überall Nullen,
  // also hält _ladeSichtbareSeiten() jeden Block für sichtbar und lädt sofort
  // alles. Im Browser passiert das nicht — dort haben die Blöcke echte
  // Koordinaten. Geprüft wird hier deshalb das ERGEBNIS des Nachladens; dass
  // Platzhalter überhaupt eine Höhe bekommen, prüft die Quelltextregel weiter
  // unten.
  await sleep(80);
  check('alle Seiten geladen (85 Kacheln)', echteKacheln() === 85, echteKacheln());
  check('keine Platzhalter mehr übrig', platzhalter() === 0, platzhalter());

  // Eine geladene Seite darf kein zweites Mal geholt werden — sonst löste
  // jeder Scroll-Schritt denselben Abruf erneut aus.
  const nachSeite2 = requests.length;
  zeigeSeite(2);
  await sleep(60);
  check('geladene Seite wird nicht erneut geholt', requests.length === nachSeite2,
    requests.length - nachSeite2);

  // ── Der Jahresfilter über die Auswahlfelder BLEIBT ──────────────────────
  w.G('cat-year-from').value = '2027'; fire(w.G('cat-year-from'), 'change');
  await sleep(80);
  check('Anfrage mit year_from=2027', lastSetsReq().includes('year_from=2027'), lastSetsReq());
  check('nur die 4 Zukunfts-Sets', echteKacheln() === 4, echteKacheln());
  check('ein einziger Block', bloecke().length === 1, bloecke().length);
  w.G('cat-year-from').value = ''; fire(w.G('cat-year-from'), 'change');
  await sleep(80);
  check('ohne Filter wieder alles', hasYearFilter(lastSetsReq()) === false, lastSetsReq());

  // ── Der Scrollbalken gehört der ganzen Anwendung ────────────────────────
  //
  // Marcos Vorgabe: „Der rechte Scrollbalken ist der vom Browser, der durch den
  // eigenen ersetzt werden soll. Gerne gleich in der ganzen App."
  //
  // Meine vorige Fassung war ein eigener Scrollkasten NUR im Katalog. Der sass
  // mitten im Fenster statt am Rand — und schlimmer: Der Beobachter mass gegen
  // diesen Kasten, weshalb beim Scrollen nach unten nichts nachkam. Jetzt rollt
  // die Seite, der Balken ist fest am Fensterrand, und der Katalog steuert nur
  // das Etikett bei.
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  check('Browser-Balken ausgeblendet (Firefox)', /html\{scrollbar-width:none/.test(css), null);
  check('Browser-Balken ausgeblendet (WebKit)', /html::-webkit-scrollbar\{width:0/.test(css), null);
  check('eigener Balken am Fensterrand',
    /#app-scrollbar\{[^}]*position:fixed[^}]*right:0/.test(css), null);

  const kern = require('./helpers/sources').coreQuelle();
  check('der Balken rollt die Seite', /window\.scrollTo\(/.test(kern), null);
  // Ohne diese Beobachtung bliebe der Griff auf seiner alten Grösse, wenn
  // Kacheln nachladen und die Seite länger wird.
  check('Griff folgt der wachsenden Seite', /ResizeObserver/.test(kern), null);

  const quelle = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', '09-catalog.js'), 'utf8');
  check('kein eigener Scrollkasten mehr', !/cat-scroller/.test(quelle), null);
  // Der Beobachter misst wieder gegen das FENSTER.
  check('Beobachter ohne eigene Wurzel', !/root: G\(/.test(quelle), null);
  // Und der zweite Weg, der unabhängig vom Beobachter lädt — genau der Fehler,
  // den Marco gemeldet hat („beim Scrollen erscheinen keine Einträge").
  check('Seiten laden auch ohne Beobachter', /_ladeSichtbareSeiten/.test(quelle), null);
  check('nach dem Füllen wird erneut nachgesehen',
    /_catItems = _catItems\.concat\(d\.sets\);[\s\S]{0,200}_ladeSichtbareSeiten\(\)/.test(quelle), null);
  check('Kacheln tragen ihr Jahr', /data-year="/.test(quelle), null);
  // Ungeladene Seiten sind EIN leerer Block, nicht 60 Kachel-Platzhalter: Bei
  // 25 000 Sets wären das über 25 000 Elemente auf einmal.
  check('leere Seite ist ein einzelner Block',
    /class="cat-page cat-page-ph" data-page=/.test(quelle), null);
  // Und seine Höhe wird an der ERSTEN, echten Seite GEMESSEN. Geraten wäre sie
  // falsch, sobald das Fenster eine andere Spaltenzahl ergibt — dann springt
  // die Liste beim Nachladen und man verliert die Stelle.
  check('Höhe wird gemessen, nicht geraten',
    /erste\.offsetHeight/.test(quelle) && /_setzePlatzhalterHoehe\(\)/.test(quelle), null);
  // Der verlässliche Ladeweg: das Scroll-Ereignis selbst, gedrosselt.
  check('Scrollen löst das Nachladen aus',
    /addEventListener\('scroll', beiBewegung/.test(quelle), null);
  check('gedrosselt über requestAnimationFrame',
    /requestAnimationFrame\([\s\S]{0,120}_ladeSichtbareSeiten/.test(quelle), null);
  // ── Die Last beim Ziehen (Nachtrag 96) ──────────────────────────────────
  // Zwei Regeln, die zusammen verhindern, dass ein Zug über die ganze Leiste
  // den Rechner blockiert:
  //
  // 1. Die Lagen der Blöcke werden EINMAL gemessen, nicht bei jedem Bild. Bei
  //    über vierhundert Blöcken zwingt jede Abfrage den Browser zu einer
  //    Layout-Neuberechnung — sechzigmal je Sekunde.
  check('Blocklagen kommen aus dem Gedächtnis',
    /_catBlockLagen/.test(quelle) && /function _messeBloecke/.test(quelle), null);
  check('beim Rollen wird NICHT neu gemessen',
    !/requestAnimationFrame\([\s\S]{0,160}_messeBloecke/.test(quelle), null);
  // 2. Geladen wird erst, wenn das Rollen zur Ruhe kommt. Sonst fordert ein Zug
  //    über die Leiste hunderte Seiten an, von denen nur die letzte zählt.
  check('Laden wartet auf Ruhe',
    /_catLadeTimer = setTimeout\(tun, \d+\)/.test(quelle), null);
  // Der Beobachter ist entfallen — ein Weg, der immer greift, statt zweier,
  // die sich ergänzen sollen.
  check('kein zweiter Ladeweg mehr', !/new IntersectionObserver/.test(quelle), null);
  check('der Katalog meldet sein Etikett an', /setScrollLabel\(/.test(quelle), null);
  check('Etikett liest zuerst die sichtbare Kachel', /karte\.dataset\.year/.test(quelle), null);
  // Und wo nichts geladen ist, wird über die tatsächliche VERTEILUNG gerechnet,
  // nicht linear geschätzt. Die lineare Fassung zeigte bei 90 % „1966", wo in
  // Wahrheit 1995 stand — Marcos Befund.
  check('Etikett rechnet über die Verteilung',
    /_catJahrVerteilung/.test(quelle) && /year-verteilung/.test(quelle), null);
  check('keine lineare Schätzung mehr',
    !/_catYearMax - anteil \* spanne/.test(quelle), null);
  check('Etikett ist angemeldet', typeof w.__scrollLabelFn === 'function', typeof w.__scrollLabelFn);

  assert.deepEqual(problems, []);
});
