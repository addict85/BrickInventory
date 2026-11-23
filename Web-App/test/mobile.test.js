/**
 * Frontend tests for public/js/mobile.js in jsdom.
 *
 * Counter-check: in public/js/mobile.js no cell gets its data-label → red “data-label comes from the header row”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'mobile.js'), 'utf8');

/** Fresh document with mobile.js loaded. */
function boot(bodyHtml) {
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml || ''}</body></html>`, { runScripts: 'outside-only' });
  dom.window.eval(SRC);
  return dom;
}

test('data-label comes from the header row', () => {
  const dom = boot(`
    <table class="dt">
      <thead><tr><th>Nr.</th><th>Name</th><th>Preis</th></tr></thead>
      <tbody><tr><td>75192-1</td><td>Falcon</td><td>CHF 800</td></tr></tbody>
    </table>`);
  const tds = [...dom.window.document.querySelectorAll('td')];
  assert.deepEqual(
    tds.map(td => td.getAttribute('data-label')),
    ['Nr.', 'Name', 'Preis'],
  );
});

test('with a multi-row header the bottom row counts', () => {
  // Occurs in the finance tables: a group heading above the
  // actual column names.
  const dom = boot(`
    <table class="dt">
      <thead>
        <tr><th colspan="2">Zeitraum</th></tr>
        <tr><th>Von</th><th>Bis</th></tr>
      </thead>
      <tbody><tr><td>2024</td><td>2026</td></tr></tbody>
    </table>`);
  const tds = [...dom.window.document.querySelectorAll('tbody td')];
  assert.deepEqual(
    tds.map(td => td.getAttribute('data-label')),
    ['Von', 'Bis'],
  );
});

test('colspan does not shift the assignment', () => {
  const dom = boot(`
    <table class="dt">
      <thead><tr><th>A</th><th>B</th><th>C</th></tr></thead>
      <tbody><tr><td colspan="2">zusammen</td><td>dritte</td></tr></tbody>
    </table>`);
  const tds = [...dom.window.document.querySelectorAll('tbody td')];
  assert.equal(tds[0].getAttribute('data-label'), 'A');
  assert.equal(tds[1].getAttribute('data-label'), 'C', 'After a colspan=2 the next cell must hit column C, not B');
});

test('empty column headers yield an empty label', () => {
  // Action columns (delete button) have no <th> text; mobile.css then hides
  // the label via content:none.
  const dom = boot(`
    <table class="dt">
      <thead><tr><th>Name</th><th></th></tr></thead>
      <tbody><tr><td>X</td><td><button>×</button></td></tr></tbody>
    </table>`);
  const tds = [...dom.window.document.querySelectorAll('tbody td')];
  assert.equal(tds[1].getAttribute('data-label'), '');
});

test('tables inserted later are labeled as well', async () => {
  // The actual purpose of the observer: the lists are built via innerHTML,
  // long after the script was loaded.
  const dom = boot('<div id="host"></div>');
  dom.window.document.getElementById('host').innerHTML = `
    <table class="dt">
      <thead><tr><th>Teil</th><th>Menge</th></tr></thead>
      <tbody><tr><td>3001</td><td>4</td></tr></tbody>
    </table>`;
  await new Promise(r => setTimeout(r, 20)); // MutationObserver is asynchronous
  const tds = [...dom.window.document.querySelectorAll('tbody td')];
  assert.deepEqual(
    tds.map(td => td.getAttribute('data-label')),
    ['Teil', 'Menge'],
  );
});

test('existing data-label are not overwritten', () => {
  const dom = boot(`
    <table class="dt">
      <thead><tr><th>Kopf</th></tr></thead>
      <tbody><tr><td data-label="eigen">x</td></tr></tbody>
    </table>`);
  assert.equal(dom.window.document.querySelector('td').getAttribute('data-label'), 'eigen');
});

test('tables without .dt stay untouched', () => {
  const dom = boot(`
    <table>
      <thead><tr><th>Kopf</th></tr></thead>
      <tbody><tr><td>x</td></tr></tbody>
    </table>`);
  assert.equal(dom.window.document.querySelector('td').hasAttribute('data-label'), false);
});

test('a table is processed only once', () => {
  const dom = boot(`
    <table class="dt">
      <thead><tr><th>Kopf</th></tr></thead>
      <tbody><tr><td>x</td></tr></tbody>
    </table>`);
  const table = dom.window.document.querySelector('table');
  assert.equal(
    table.dataset.labelled,
    '1',
    'Without a marker the observer would run over all tables again on every DOM change',
  );
});

test('mobile.css covers both themes and lives entirely in media queries', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'mobile.css'), 'utf8');
  // Everything outside of an @media rule would change the desktop.
  const outside = css
    .replace(/\/\*[\s\S]*?\*\//g, '') // comments gone
    .replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '') // media blocks gone
    // Container queries only apply where a container exists — and
    // mobile.css only creates that inside of @media (checked below).
    .replace(/@container[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
    .trim();
  assert.equal(outside, '', `Rules outside @media would hit the desktop:\n${outside.slice(0, 300)}`);

  const withoutMedia = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  assert.doesNotMatch(withoutMedia, /container\s*:/, 'A container outside @media changes the desktop too');
  assert.match(css, /\[data-theme="brick"\]/, 'The brick design needs its own rules for studs and paddings');
  assert.match(css, /#login-screen/, 'The login page must be covered too');
  assert.match(css, /font-size:\s*16px/, 'Below 16px iOS zooms into input fields on focus');
});

test('index.html loads mobile.css after both themes', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const iTheme = html.indexOf('themes/brick.css');
  const iMobile = html.indexOf('mobile.css');
  const iBase = html.indexOf('styles.css');
  assert.ok(iMobile > 0, 'mobile.css is not included');
  assert.ok(
    iMobile > iTheme && iMobile > iBase,
    'mobile.css must come AFTER styles.css and the theme, otherwise the theme wins',
  );
  // Since the bundling, mobile.js no longer stands as its own <script> tag
  // in index.html but in js/app.bundle.js. Hence what is checked is that it
  // is part of the bundle — in substance the same assertion.
  // Since the switch to ES modules there is no file list any more but
  // a module graph: js/main.js imports the parts, esbuild bundles them.
  const entry = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'main.js'), 'utf8');
  assert.match(entry, /'\.\/mobile\.js'/, 'mobile.js is not imported by js/main.js and would not be shipped');
  assert.match(html, /app\.bundle\.js/, 'The frontend bundle is not included');
});
