/**
 * The application's own scrollbar really appears.
 *
 * Counter-check (performed): creation removed and instead, as before,
 * `G('app-scrollbar')` expected → “bar created" turns red.
 *
 * Counter-check: `if (requested) return;` removed in public/js/scrollbar.js → red “redrawing is throttled”.
 * Counter-check: `label.style.display = ''` after dragging removed → red “the label disappears again after dragging”.
 * Counter-check: without a registered function the label shows '1999' → red “the label stays empty as long as nobody registers it”.
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
    'No bar in the document. It must NOT come from the markup — the script ' +
      'runs before the end of the body, noted there it would not exist at start.',
  );
  assert.equal(bar.style.display, 'block', 'The bar stays hidden although the page is scrollable');
  const thumb = w.document.getElementById('app-scrollbar-thumb');
  assert.ok(thumb && parseInt(thumb.style.height, 10) > 0, `The thumb has no height: ${thumb?.style.height}`);
});

test('without a scroll area it disappears again', () => {
  // Opposite direction: a bar over a page that fits completely into the window
  // would only be decoration — and without this check the test would also be green if
  // the visibility were hard-wired.
  const w = stage({ scrollHeight: 700, innerHeight: 800 });
  w.eval('initScrollbar();');
  assert.equal(w.document.getElementById('app-scrollbar').style.display, 'none');
});

/** A stage whose animation frames wait until the test runs them, and whose scrollTo does nothing. */
function frameStage() {
  const w = stage();
  const frames = [];
  w.requestAnimationFrame = cb => frames.push(cb);
  w.scrollTo = () => {};
  w.eval('initScrollbar();');
  return { w, frames, bar: w.document.getElementById('app-scrollbar') };
}

test('redrawing is throttled', () => {
  // drawScrollbar() reads layout; a burst of scroll events must cost one frame, not one per event.
  const { w, frames } = frameStage();
  for (let i = 0; i < 10; i++) w.dispatchEvent(new w.Event('scroll'));
  assert.equal(frames.length, 1, `${frames.length} frames requested for ten scroll events`);
  frames.shift()();
  w.dispatchEvent(new w.Event('scroll'));
  assert.equal(frames.length, 1, 'after the frame ran, the next scroll event requests a new one');
});

test('the label disappears again after dragging', () => {
  const { w, bar } = frameStage();
  w.eval("setScrollLabel(() => '2019');");
  const label = w.document.getElementById('app-scrollbar-label');
  bar.dispatchEvent(new w.MouseEvent('mousedown', { clientY: 100, bubbles: true }));
  assert.equal(label.textContent, '2019', 'while dragging the label shows the registered text');
  assert.equal(label.style.display, 'block');
  w.dispatchEvent(new w.MouseEvent('mouseup', { bubbles: true }));
  assert.equal(label.style.display, '', 'the inline visibility stays after letting go and beats the stylesheet');
});

test('the label stays empty as long as nobody registers it', () => {
  const { w, bar } = frameStage();
  const label = w.document.getElementById('app-scrollbar-label');
  bar.dispatchEvent(new w.MouseEvent('mousedown', { clientY: 100, bubbles: true }));
  assert.equal(label.textContent, '');
  assert.equal(label.style.display, 'none', 'without a registered function the label must stay hidden');
  w.dispatchEvent(new w.MouseEvent('mouseup', { bubbles: true }));
  w.eval("setScrollLabel(() => '2020'); setScrollLabel(null);");
  bar.dispatchEvent(new w.MouseEvent('mousedown', { clientY: 100, bubbles: true }));
  assert.equal(label.textContent, '', 'an unregistered function still delivers its text');
});

test('the label is unregistered when leaving the catalog', () => {
  const gal = fs.readFileSync(path.join(ROOT, 'public', 'js', 'navigation.js'), 'utf8');
  assert.match(
    gal,
    /if \(tab !== 'catalog'\) setScrollLabel\(null\)/,
    'The label function is not unregistered when switching tabs',
  );
});
