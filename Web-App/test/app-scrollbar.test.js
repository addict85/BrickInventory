/**
 * The application's own scrollbar really appears.
 *
 * Counter-check (performed): creation removed and instead, as before,
 * `G('app-scrollbar')` expected → “bar created" turns red.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

/**
 * Evaluate the scrollbar code.
 */
function scrollbarCode() {
  const roh = fs.readFileSync(path.join(ROOT, 'public', 'js', 'scrollbar.js'), 'utf8');
  return roh.replace(/^import .*$/gm, '').replace(/^export\s+/gm, '');
}

/** Small stage with faked layout — jsdom computes none. */
function stage({ scrollHeight = 5000, innerHeight = 800 } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const w = dom.window;
  w.eval('window.G = id => document.getElementById(id);');
  Object.assign(w, require('./helpers/markup').markupHelper());
  w.eval(`
    Object.defineProperty(document.documentElement,'scrollHeight',{value:${scrollHeight},configurable:true});
    Object.defineProperty(window,'innerHeight',{value:${innerHeight},configurable:true});
    window.ResizeObserver = class { constructor(cb){this.cb=cb;} observe(){} disconnect(){} };
  `);
  w.eval(scrollbarCode());
  return w;
}

test('the bar is created and appears on a scrollable page', () => {
  const w = stage();
  w.eval('initScrollbar();');
  const bar = w.document.getElementById('app-scrollbar');
  assert.ok(
    bar,
    'Kein Balken im Dokument. Er darf NICHT aus dem Markup kommen — das Skript ' +
      'läuft vor dem Ende des Body, dort notiert gäbe es ihn beim Start nicht.',
  );
  assert.equal(bar.style.display, 'block', 'Der Balken bleibt verborgen, obwohl die Seite rollbar ist');
  const thumb = w.document.getElementById('app-scrollbar-thumb');
  assert.ok(thumb && parseInt(thumb.style.height, 10) > 0, `Der Griff hat keine Höhe: ${thumb?.style.height}`);
});

test('without a scroll area it disappears again', () => {
  // Opposite direction: a bar over a page that fits completely into the window
  // would only be decoration — and without this check the test would also be green if
  // the visibility were hard-wired.
  const w = stage({ scrollHeight: 700, innerHeight: 800 });
  w.eval('initScrollbar();');
  assert.equal(w.document.getElementById('app-scrollbar').style.display, 'none');
});

test('redrawing is throttled', () => {
  // drawScrollbar() READS layout (scrollHeight). Unthrottled, every
  // scroll event forces a recomputation — dozens of times per second. The
  // page then feels sluggish although the server answered long ago.
  const code = scrollbarCode();
  assert.match(code, /requestAnimationFrame\(/, 'Das Neuzeichnen hängt ungedrosselt am Scroll-Ereignis');
  const i = code.indexOf("addEventListener('scroll'");
  assert.ok(i > 0, 'Kein Scroll-Zuhörer');
  assert.match(code.slice(0, i), /angefordert/, 'Der Zuhörer ruft nicht die gedrosselte Fassung');
});

test('the label disappears again after dragging', () => {
  // Marco's screenshot
  const code = scrollbarCode();
  const i = code.indexOf('const ende =');
  assert.ok(i > 0, 'Kein Ende-Handler');
  // Cut up to the END of the handler, not by fixed length: the
  // rationale in the comment is longer than any window I would guess
  // — the same trap that has already struck five times in this project.
  const fn = code.slice(i, code.indexOf('\n  };', i));
  assert.match(
    fn,
    /label\.style\.display = ''/,
    'Die inline gesetzte Sichtbarkeit wird nach dem Ziehen nicht zurückgenommen — ' +
      'dann bleibt das Etikett in jedem Reiter stehen',
  );
});

test('the label is unregistered when leaving the catalog', () => {
  const gal = fs.readFileSync(path.join(ROOT, 'public', 'js', 'navigation.js'), 'utf8');
  assert.match(
    gal,
    /if \(tab !== 'catalog'\) setScrollLabel\(null\)/,
    'Beim Reiterwechsel wird die Etikett-Funktion nicht abgemeldet',
  );
});

test('the label stays empty as long as nobody registers it', () => {
  // The bar belongs to the whole application; the year is an ingredient of the
  // catalog. Without login nothing may stand there — otherwise every
  // tab would show a number that means nothing to it.
  const code = scrollbarCode();
  assert.match(
    code,
    /export let scrollLabelFn = null|let scrollLabelFn = null/,
    'Es gibt keine Anmeldestelle für das Etikett',
  );
  assert.match(
    code,
    /scrollLabelFn \? scrollLabelFn\(\) : null/,
    'Das Etikett fragt die angemeldete Funktion nicht ab',
  );
});
