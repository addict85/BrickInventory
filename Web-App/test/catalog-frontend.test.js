/**
 * Frontend tests for public/js/catalog.js in jsdom (devDependency).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

/**
 * Remove import/export syntax from a module file.
 * @param {string} src
 * @returns {string}
 */
function stripModuleSyntax(src) {
  const body = src
    .replace(/^import[^;]*;\s*$/gm, '') // import { a, b } from '…';
    .replace(/^export\s+/gm, ''); // export function/const/let/class
  // registerActions() otherwise comes from js/registry.js and is not defined after
  // removing the imports. In the sandbox the registration does not
  // matter — that it IS called is checked by test/csp-actions.test.js
  // and test/bundle-smoke.test.js against the real source text. …
  return (
    'function registerActions() {}\n' + 'function tRaw(k, v) { return typeof t === "function" ? t(k, v) : k; }\n' + body
  );
}

// The view building blocks go INTO the sandbox, not as a dummy.
const BAUSTEINE = stripModuleSyntax(
  fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'components.js'), 'utf8'),
);
const CODE =
  BAUSTEINE +
  '\n' +
  stripModuleSyntax(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'load-guard.js'), 'utf8')) +
  '\n' +
  stripModuleSyntax(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'catalog.js'), 'utf8'));
const dom = new JSDOM(
  `<!doctype html><html><body>
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
</body></html>`,
  { runScripts: 'outside-only', pretendToBeVisual: true },
);

const w = dom.window;

// ── Mini backend: same semantics as the (tested) server ──────────────────────
const DATA = [];
for (let y = 2000; y <= 2026; y++)
  for (let k = 0; k < 3; k++)
    DATA.push({
      set_number: `${y}${k}-1`,
      name: `Set ${y}-${k}`,
      year: y,
      theme_id: 1,
      theme_name: 'Star Wars',
      num_parts: 100,
      image_url: '',
      owned: false,
      owned_quantity: 0,
    });
for (let k = 0; k < 4; k++)
  DATA.push({
    set_number: `900${k}-1`,
    name: `Future ${k}`,
    year: 2027,
    theme_id: 1,
    theme_name: 'Star Wars',
    num_parts: 500,
    image_url: '',
    owned: false,
    owned_quantity: 0,
  });

const requests = [];
function fakeApi(_method, url) {
  requests.push(url);
  if (url.startsWith('/v1/catalog/meta')) {
    const counts = {};
    for (const s of DATA) counts[s.year] = (counts[s.year] || 0) + 1;
    return Promise.resolve({
      success: true,
      themes: [{ id: 1, name: 'Star Wars', set_count: DATA.length }],
      year_min: 2000,
      year_max: 2027,
      year_counts: Object.entries(counts).map(([y, n]) => ({ year: +y, n })),
    });
  }
  if (url.startsWith('/v1/catalog/sets?')) {
    const p = new w.URLSearchParams(url.split('?')[1]);
    let rows = DATA.slice();
    if (p.get('q')) rows = rows.filter(s => s.name.includes(p.get('q')) || s.set_number.includes(p.get('q')));
    if (p.get('year_from')) rows = rows.filter(s => s.year >= parseInt(p.get('year_from'), 10));
    if (p.get('year_to')) rows = rows.filter(s => s.year <= parseInt(p.get('year_to'), 10));
    const limit = parseInt(p.get('limit') || '60', 10),
      page = parseInt(p.get('page') || '1', 10);
    return Promise.resolve({
      success: true,
      total: rows.length,
      page,
      pages: Math.max(1, Math.ceil(rows.length / limit)),
      sets: rows.slice((page - 1) * limit, page * limit),
    });
  }
  if (url.startsWith('/v1/catalog/year-verteilung')) {
    const p = new w.URLSearchParams(url.split('?')[1] || '');
    const absteigend = p.get('sort') !== 'year_asc';
    const counts = {};
    for (const s of DATA) counts[s.year] = (counts[s.year] || 0) + 1;
    const years = Object.entries(counts)
      .map(([y, n]) => ({ year: +y, n }))
      .sort((a, b) => (absteigend ? b.year - a.year : a.year - b.year));
    return Promise.resolve({ success: true, years });
  }
  return Promise.resolve({ success: false, error: 'unbekannt: ' + url });
}

// ── Global stubs as the building blocks and i18n provide them ──────────────────────────
Object.assign(w, require('./helpers/markup').markupHelper());
w.eval(`
  window.G = id => document.getElementById(id);
  window.queryAll = (s, w = document) => [...w.querySelectorAll(s)]; window.queryOne = (s, w = document) => w.querySelector(s);
  window.t = (k, v) => { let s = k; if (v) for (const [a,b] of Object.entries(v)) s += ' ' + b; return s; };
  window.locale = () => 'de-CH';
  window.toast = () => {}; window.reportHits = () => {};
  window.PLACEHOLDER_SET = '/assets/set-placeholder.svg'; window.setDialogImage = (img, src) => { img.src = src; };
  // Das Teile-Symbol kommt aus collection.js und wird hier nur als Marke
  // gebraucht: Der Test prüft die Katalog-Kachel, nicht das Bild darin.
  // Seit einer früheren Runde steht es dort statt des Puzzleteil-Emojis.
  window.PARTS_ICON_SVG = '<svg data-test-parts-icon></svg>';
  // Bild und Platzhalter kommen aus bilder.js; hier zählt nur die Kachel.
  window.imageTag = o => '<img src="' + o.src + '" alt="">';
  window.placeholderContent = () => '';
  // Den gemeinsamen Scrollbalken stellt js/rollbalken.js; hier zählt nur, DASS
  // der Katalog sein Etikett dort anmeldet.
  window.__scrollLabelFn = undefined;
  window.setScrollLabel = fn => { window.__scrollLabelFn = fn; };
`);
w.api = fakeApi;
// jsdom has no IntersectionObserver — the stub captures the callback so that
// the test can simulate the sentinel becoming visible.
w.eval(`
  window.__ioCallbacks = [];
  window.IntersectionObserver = class {
    constructor(cb) { window.__ioCallbacks.push(cb); }
    observe() {} unobserve() {} disconnect() {}
  };
`);
// jsdom does not know scrollIntoView (no layout). For the jump what counts is WHERE
// it would scroll to — the stub records that.
w.eval(`
  window.__scrollZiele = [];
  Element.prototype.scrollIntoView = function () { window.__scrollZiele.push(this); };
`);
w.eval(CODE);
const { warte: sleep } = require('./helpers/time');
const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));
const problems = [];
const check = (name, cond, extra) => {
  if (!cond) problems.push(`${name}  ${extra !== undefined ? JSON.stringify(extra) : ''}`);
};
const lastSetsReq = () => requests.filter(u => u.includes('/catalog/sets?')).pop();
const hasYearFilter = u => /[?&]year_(from|to)=/.test(u);
const bloecke = () => w.document.querySelectorAll('#catalog-grid .cat-page');
const realTiles = () => w.document.querySelectorAll('#catalog-grid .sc:not(.cat-page-ph)').length;
const platzhalter = () => w.document.querySelectorAll('#catalog-grid .cat-page-ph').length;
/** Push a page into view — as the observer reports it. */
const showPage = n => {
  const el = w.document.querySelector(`#catalog-grid .cat-page[data-page="${n}"]`);
  for (const cb of w.__ioCallbacks) cb([{ isIntersecting: true, target: el }]);
};

test('catalog frontend: page blocks, year filter, own scroll bar', async () => {
  w.eval('initCatalog()');
  await sleep(80);

  // ── Layout: one block per page over the WHOLE result ──────────────────
  check('Erste Anfrage OHNE Jahresfilter', !hasYearFilter(lastSetsReq()), lastSetsReq());
  check('85 Sets, also 2 Seitenblöcke', bloecke().length === 2, bloecke().length);

  // jsdom computes NO layout: getBoundingClientRect() returns zeros everywhere,
  // so _loadVisiblePages() considers every block visible and loads everything
  // immediately. In the browser that does not happen — there the blocks have real
  // coordinates. What is checked here is therefore the RESULT of loading more; that …
  await sleep(80);
  check('alle Seiten geladen (85 Kacheln)', realTiles() === 85, realTiles());
  check('keine Platzhalter mehr übrig', platzhalter() === 0, platzhalter());

  // A loaded page must not be fetched a second time — otherwise every
  // scroll step would trigger the same fetch again.
  const afterSeite2 = requests.length;
  showPage(2);
  await sleep(60);
  check('geladene Seite wird nicht erneut geholt', requests.length === afterSeite2, requests.length - afterSeite2);

  // ── The year filter via the select fields STAYS ──────────────────────
  w.G('cat-year-from').value = '2027';
  fire(w.G('cat-year-from'), 'change');
  await sleep(80);
  check('Anfrage mit year_from=2027', lastSetsReq().includes('year_from=2027'), lastSetsReq());
  check('nur die 4 Zukunfts-Sets', realTiles() === 4, realTiles());
  check('ein einziger Block', bloecke().length === 1, bloecke().length);
  w.G('cat-year-from').value = '';
  fire(w.G('cat-year-from'), 'change');
  await sleep(80);
  check('ohne Filter wieder alles', hasYearFilter(lastSetsReq()) === false, lastSetsReq());

  // The scrollbar belongs to the whole application
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  check('Browser-Balken ausgeblendet (Firefox)', /html\{scrollbar-width:none/.test(css), null);
  check('Browser-Balken ausgeblendet (WebKit)', /html::-webkit-scrollbar\{width:0/.test(css), null);
  check('eigener Balken am Fensterrand', /#app-scrollbar\{[^}]*position:fixed[^}]*right:0/.test(css), null);

  const kern = require('./helpers/sources').coreSource();
  check('der Balken rollt die Seite', /window\.scrollTo\(/.test(kern), null);
  // Without this observation the thumb would stay at its old size when
  // tiles load and the page gets longer.
  check('Griff folgt der wachsenden Seite', /ResizeObserver/.test(kern), null);

  const quelle = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'catalog.js'), 'utf8');
  check('kein eigener Scrollkasten mehr', !/cat-scroller/.test(quelle), null);
  // The observer measures against the WINDOW again.
  check('Beobachter ohne eigene Wurzel', !/root: G\(/.test(quelle), null);
  // And the second path that loads independently of the observer — exactly the bug
  // Marco reported (“no entries appear when scrolling").
  check('Seiten laden auch ohne Beobachter', /_loadVisiblePages/.test(quelle), null);
  check(
    'nach dem Füllen wird erneut nachgesehen',
    /_catItems = _catItems\.concat\(d\.sets\);[\s\S]{0,200}_loadVisiblePages\(\)/.test(quelle),
    null,
  );
  check('Kacheln tragen ihr Jahr', /data-year="/.test(quelle), null);
  // Unloaded pages are ONE empty block, not 60 tile placeholders: with
  // 25 000 sets that would be over 25 000 elements at once.
  check('leere Seite ist ein einzelner Block', /class="cat-page cat-page-ph" data-page=/.test(quelle), null);
  // And its height is MEASURED on the FIRST real page. Guessed it would be
  // wrong as soon as the window yields a different column count — then the list
  // jumps when loading more and one loses the place.
  check(
    'Höhe wird gemessen, nicht geraten',
    /first\.offsetHeight/.test(quelle) && /_setPlaceholderHeight\(\)/.test(quelle),
    null,
  );
  // The reliable loading path: the scroll event itself, throttled.
  check('Scrollen löst das Nachladen aus', /addEventListener\('scroll', atMovement/.test(quelle), null);
  check(
    'gedrosselt über requestAnimationFrame',
    /requestAnimationFrame\([\s\S]{0,120}_loadVisiblePages/.test(quelle),
    null,
  );
  // The load while dragging
  check(
    'Blocklagen kommen aus dem Gedächtnis',
    /_catBlockStates/.test(quelle) && /function _measureBlocks/.test(quelle),
    null,
  );
  check(
    'beim Rollen wird NICHT neu gemessen',
    !/requestAnimationFrame\([\s\S]{0,160}_measureBlocks/.test(quelle),
    null,
  );
  // 2. Loading only happens at rest; that this works is measured by catalog-move-debounced.test.js.
  check('Laden wartet auf Ruhe', /_catLoadTimer = setTimeout\(tun, \d+\)/.test(quelle), null);
  // The observer is gone — one path that always applies instead of two
  // that are supposed to complement each other.
  check('kein zweiter Ladeweg mehr', !/new IntersectionObserver/.test(quelle), null);
  check('der Katalog meldet sein Etikett an', /setScrollLabel\(/.test(quelle), null);
  check('Etikett liest zuerst die sichtbare Kachel', /card\.dataset\.year/.test(quelle), null);
  // And where nothing is loaded, the computation uses the actual DISTRIBUTION,
  // not a linear estimate. The linear version showed “1966" at 90 %, where
  // in truth it was 1995 — Marco's finding.
  check(
    'Etikett rechnet über die Verteilung',
    /_catYearDistribution/.test(quelle) && /year-verteilung/.test(quelle),
    null,
  );
  check('keine lineare Schätzung mehr', !/_catYearMax - anteil \* spanne/.test(quelle), null);

  check('Etikett ist angemeldet', typeof w.__scrollLabelFn === 'function', typeof w.__scrollLabelFn);

  assert.deepEqual(problems, []);
});
