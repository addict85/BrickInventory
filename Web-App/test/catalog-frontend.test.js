/**
 * Frontend-Tests für public/js/09-catalog.js in jsdom (devDependency).
 * Ausführlich: docs/begruendungen/test/catalog-frontend.test.js.md#kopf
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

/**
 * import-/export-Syntax aus einer Moduldatei entfernen.
 * Ausführlich: docs/begruendungen/test/catalog-frontend.test.js.md#stripmodulesyntax
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
  // und test/bundle-smoke.test.js gegen den echten Quelltext. …
  // Ausführlich: docs/begruendungen/test/catalog-frontend.test.js.md#registeractions
  return 'function registerActions() {}\n'
       + 'function tRaw(k, v) { return typeof t === "function" ? t(k, v) : k; }\n'
       + body;
}

// Die Ansichts-Bausteine kommen MIT in die Sandbox, nicht als Attrappe.
// Ausführlich: docs/begruendungen/test/catalog-frontend.test.js.md#bausteine
const BAUSTEINE = stripModuleSyntax(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', '01-bausteine.js'), 'utf8'));
const CODE = BAUSTEINE + '\n' + stripModuleSyntax(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', '09-catalog.js'), 'utf8'));
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
    if (p.get('year_from')) rows = rows.filter(s => s.year >= parseInt(p.get('year_from'), 10));
    if (p.get('year_to'))   rows = rows.filter(s => s.year <= parseInt(p.get('year_to'), 10));
    const limit = parseInt(p.get('limit') || '60', 10), page = parseInt(p.get('page') || '1', 10);
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
  return Promise.resolve({ success: false, error: 'unbekannt: ' + url });
}

// ── Globale Stubs, wie sie 01-*/i18n bereitstellen ────────────────────────
Object.assign(w, require('./helpers/markup').markupHelfer());
w.eval(`
  window.G = id => document.getElementById(id);
  window.alle = (s, w = document) => [...w.querySelectorAll(s)]; window.eins = (s, w = document) => w.querySelector(s);
  window.t = (k, v) => { let s = k; if (v) for (const [a,b] of Object.entries(v)) s += ' ' + b; return s; };
  window.locale = () => 'de-CH';
  window.toast = () => {}; window.meldeTreffer = () => {};
  window.PLATZHALTER_SET = '/assets/set-placeholder.svg'; window.setzeDialogbild = (img, src) => { img.src = src; };
  // Das Teile-Symbol kommt aus 02-gallery.js und wird hier nur als Marke
  // gebraucht: Der Test prüft die Katalog-Kachel, nicht das Bild darin.
  // Seit einer früheren Runde steht es dort statt des Puzzleteil-Emojis.
  window.PARTS_ICON_SVG = '<svg data-test-parts-icon></svg>';
  // Bild und Platzhalter kommen aus 01-bilder.js; hier zählt nur die Kachel.
  window.bildTag = o => '<img src="' + o.src + '" alt="">';
  window.platzhalterInhalt = () => '';
  // Den gemeinsamen Scrollbalken stellt js/15-scrollbar.js; hier zählt nur, DASS
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
const { warte: sleep } = require('./helpers/zeit');
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
  for (const cb of w.__ioCallbacks) cb([{ isIntersecting: true, target: el }]);
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
  // Koordinaten. Geprüft wird hier deshalb das ERGEBNIS des Nachladens; dass …
  // Ausführlich: docs/begruendungen/test/catalog-frontend.test.js.md#stelle
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

  // Der Scrollbalken gehört der ganzen Anwendung
  // Ausführlich: docs/begruendungen/test/catalog-frontend.test.js.md#css-stelle
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
  // Die Last beim Ziehen
  // Ausführlich: docs/begruendungen/test/catalog-frontend.test.js.md#check
  check('Blocklagen kommen aus dem Gedächtnis',
    /_catBlockLagen/.test(quelle) && /function _messeBloecke/.test(quelle), null);
  check('beim Rollen wird NICHT neu gemessen',
    !/requestAnimationFrame\([\s\S]{0,160}_messeBloecke/.test(quelle), null);
  // 2. Geladen wird erst, wenn das Rollen zur Ruhe kommt. Sonst fordert ein Zug
  //    über die Leiste hunderte Seiten an, von denen nur die letzte zählt.
  // Ausführlich: docs/begruendungen/test/catalog-frontend.test.js.md#check-2
  //
  //    Das hier ist eine Aussage über den TEXT: die Zeile steht da. Dass sie
  //    auch WIRKT, misst katalog-zug-entprellt.test.js — dort fährt ein
  //    wirklicher Zug über die Leiste, und die Gegenprobe nimmt genau diese
  //    Ruhe heraus (2 Abrufe gegen 48). Beide sagen dasselbe, keine
  //    widerspricht der anderen; wer die Zeile umbenennt, muss dort nachziehen.
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

  // Und dasselbe in der App (Marcos Vorgabe: „die gleiche Leiste")
  // Ausführlich: docs/begruendungen/test/catalog-frontend.test.js.md#kotlin
  const kotlin = [];
  const gehen = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) gehen(abs);
      else if (e.name.endsWith('.kt')) kotlin.push(abs);
    }
  };
  for (const w of require('./helpers/android').quellwurzeln()) gehen(w);
  check('die App-Quellen sind auffindbar', kotlin.length >= 40, kotlin.length);
  if (kotlin.length >= 40) {
    const kQuelle = kotlin.map(f => fs.readFileSync(f, 'utf8')).join('\n');
    const ohneKommentar = kQuelle.replace(/\/\*[\s\S]*?\*\//g, '')
                                 .replace(/^\s*\/\/[^\n]*$/gm, '');
    check('die App holt dieselbe Verteilung',
      /year-verteilung/.test(ohneKommentar), null);
    check('die App rechnet ueber die Verteilung',
      /fun jahrAnPosition\(/.test(ohneKommentar), null);
    // Die alte lineare Rechnung: aus einem Anteil wurde direkt ein Jahr.
    check('keine lineare Jahresschaetzung mehr in der App',
      !/yearMax - frac \* \(yearMax - yearMin\)/.test(ohneKommentar), null);
    // Und die Leiste haengt an der STELLE, nicht mehr am Jahr.
    check('die App springt nicht mehr auf year-offset',
      !/year-offset/.test(ohneKommentar), null);
  }
  check('Etikett ist angemeldet', typeof w.__scrollLabelFn === 'function', typeof w.__scrollLabelFn);

  assert.deepEqual(problems, []);
});
