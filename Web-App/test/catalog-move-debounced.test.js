/**
 * A drag across the year bar fetches ONE page, not a hundred.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { warte } = require('./helpers/time');

const JS = path.join(__dirname, '..', 'public', 'js');

/** Remove import/export — the file is evaluated here as a classic script. */
function withoutModuleShell(src) {
  return (
    'function registerActions(){}\n' +
    'function tRaw(k, v){ return typeof t === "function" ? t(k, v) : k; }\n' +
    src.replace(/^import[^;]*;\s*$/gm, '').replace(/^export\s+/gm, '')
  );
}

const BLOCK_HEIGHT = 900; // pixels per page block
const SEITEN = 50;
const SETS = SEITEN * 60;
const STEPS = 40; // touch points of a drag
const STEP_MS = 15; // distance between two points — faster than the rest period

/**
 * Drag across the whole bar and count the page fetches.
 * @param {boolean} debounced false = counter-check, the rest period is taken out
 */
async function measureMove(debounced) {
  let code =
    withoutModuleShell(fs.readFileSync(path.join(JS, 'components.js'), 'utf8')) +
    '\n' +
    withoutModuleShell(fs.readFileSync(path.join(JS, 'load-guard.js'), 'utf8')) +
    '\n' +
    withoutModuleShell(fs.readFileSync(path.join(JS, 'catalog.js'), 'utf8'));
  if (!debounced) {
    const vorher = code;
    code = code.replace(/_catLoadTimer = setTimeout\(tun, \d+\)/, 'tun()');
    assert.notEqual(
      code,
      vorher,
      'Die Gegenprobe hat die Entprellung nicht gefunden. Entweder heisst sie ' +
        'anders — dann diese Datei nachziehen — oder es gibt sie nicht mehr.',
    );
  }

  const dom = new JSDOM(
    `<!doctype html><html><body>
    <input id="cat-search"/>
    <select id="cat-theme"><option value=""></option></select>
    <select id="cat-year-from"><option value=""></option></select>
    <select id="cat-year-to"><option value=""></option></select>
    <select id="cat-sort"><option value="year_desc" selected></option></select>
    <div id="cat-count"></div><div id="catalog-grid"></div>
    <div id="cat-modal"></div><button id="cat-m-add"></button>
    </body></html>`,
    { runScripts: 'outside-only', pretendToBeVisual: true },
  );
  const w = dom.window;

  const daten = [];
  for (let i = 0; i < SETS; i++) {
    daten.push({
      set_number: `${i}-1`,
      name: `Set ${i}`,
      year: 2000 + (i % 27),
      theme_id: 1,
      theme_name: 'X',
      num_parts: 100,
      image_url: '',
      owned: false,
      owned_quantity: 0,
    });
  }

  const fetches = [];
  w.api = (_method, url) => {
    if (url.startsWith('/v1/catalog/meta')) {
      return Promise.resolve({ success: true, themes: [], year_min: 2000, year_max: 2026, year_counts: [] });
    }
    if (url.startsWith('/v1/catalog/sets?')) {
      const p = new w.URLSearchParams(url.split('?')[1]);
      const seite = parseInt(p.get('page') || '1', 10);
      fetches.push(seite);
      return Promise.resolve({
        success: true,
        total: SETS,
        page: seite,
        sets: daten.slice((seite - 1) * 60, seite * 60),
      });
    }
    if (url.startsWith('/v1/catalog/year-verteilung')) {
      return Promise.resolve({ success: true, years: [] });
    }
    return Promise.resolve({ success: false, error: 'unbekannt: ' + url });
  };
  Object.assign(w, require('./helpers/markup').markupHelper());
  w.eval(`
    window.G = id => document.getElementById(id);
    window.queryAll = (s, w = document) => [...w.querySelectorAll(s)]; window.queryOne = (s, w = document) => w.querySelector(s);
    window.t = k => k; window.tRaw = k => k;
    window.locale = () => 'de-CH'; window.toast = () => {}; window.reportHits = () => {};
    window.PARTS_ICON_SVG = ''; window.setScrollLabel = () => {};
    window.imgUrl = s => s;
    window.imageTag = o => '<img src="' + o.src + '" alt="">'; window.placeholderContent = () => '';
    window.thumbUrl = s => s; window.fullUrl = s => s; window.detailRow = () => '';
  `);

  // Real block positions instead of the zeros jsdom delivers without layout. Otherwise
  // EVERY block counts as visible, _loadVisiblePages() loads everything once
  // and the drag measures nothing anymore.
  let rollY = 0;
  Object.defineProperty(w, 'scrollY', { get: () => rollY, configurable: true });
  Object.defineProperty(w, 'innerHeight', { get: () => 800, configurable: true });
  w.Element.prototype.getBoundingClientRect = function () {
    const nr = this.dataset?.page;
    if (!nr) return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
    const n = parseInt(nr, 10);
    return {
      top: (n - 1) * BLOCK_HEIGHT - rollY,
      bottom: n * BLOCK_HEIGHT - rollY,
      left: 0,
      right: 0,
      width: 0,
      height: BLOCK_HEIGHT,
    };
  };

  w.eval(code);
  w.eval('initCatalog()');
  await warte(300);
  const beforeTheMove = fetches.length;

  const maxRoles = SEITEN * BLOCK_HEIGHT - 800;
  for (let i = 0; i < STEPS; i++) {
    rollY = Math.round((i / (STEPS - 1)) * maxRoles);
    w.dispatchEvent(new w.Event('scroll'));
    await warte(STEP_MS);
  }
  await warte(400); // rest after release — now loading may happen

  const inMove = fetches.slice(beforeTheMove);
  const zustand = {
    anzahl: inMove.length,
    seiten: [...new Set(inMove)].sort((a, b) => a - b),
    setup: beforeTheMove,
  };
  dom.window.close();
  return zustand;
}

test('catalog: a drag across the bar loads the target, not the way there', async () => {
  const mit = await measureMove(true);
  const ohne = await measureMove(false);

  // The test bench must do something at all: on setup the first page is
  // fetched. If that did not happen, “few fetches" would be meaningless.
  assert.ok(mit.setup >= 1, `Der Aufbau holte keine Seite (${mit.setup}) — der Pruefstand laeuft leer`);

  // The counter-check proves that the drag leads across many pages at all.
  // Without it the bar might only sweep across a few blocks.
  assert.ok(
    ohne.seiten.length >= 25,
    `Ohne die Ruhe wurden nur ${ohne.seiten.length} Seiten geholt. Dann fuehrt ` +
      `der Zug gar nicht ueber den ganzen Katalog und diese Messung sagt nichts aus.`,
  );

  // And the actual assurance: WITH the rest period it stays at a handful.
  assert.ok(
    mit.anzahl <= 10,
    `Ein Zug ueber die Leiste loeste ${mit.anzahl} Seitenabrufe aus (Seiten ` +
      `${JSON.stringify(mit.seiten)}). Erwartet ist das Ziel samt Nachbarn. ` +
      `Geladen wird offenbar wieder unterwegs — genau Marcos „dauert einige Sekunden".`,
  );

  // The gap is the most robust statement: both runs are in the same
  // process under the same conditions, a delay hits both.
  assert.ok(
    ohne.anzahl >= mit.anzahl * 5,
    `Mit Ruhe ${mit.anzahl} Abrufe, ohne ${ohne.anzahl} — die Ruhe macht keinen ` +
      `Unterschied mehr. Entweder laedt der Zug am Timer vorbei, oder die ` +
      `Gegenprobe trifft die falsche Stelle.`,
  );

  // The target must really arrive: loading less is only right
  // if the end of the drag is shown afterwards.
  const letzte = SEITEN;
  assert.ok(
    mit.seiten.includes(letzte),
    `Die Zielseite ${letzte} wurde nie geholt (${JSON.stringify(mit.seiten)}) — ` +
      `dann spart die Entprellung Abrufe, indem sie den Sprung ins Leere laufen laesst.`,
  );
});
