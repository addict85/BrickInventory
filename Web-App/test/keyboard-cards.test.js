/**
 * Cards and rows with data-click can be triggered by keyboard —
 * on the real bundle in jsdom (public/js/actions.js).
 *
 * Counter-check (measured on 27.10.): the keydown listener in aktionen.js
 * removed → red: “Enter on a card".
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const jsdom = require(path.join(ROOT, 'node_modules', 'jsdom'));
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const { BUENDEL, placeBundleSafe } = require('./helpers/bundle');
placeBundleSafe();
const BUNDLE = fs.readFileSync(BUENDEL, 'utf8');

async function fenster() {
  const dom = new jsdom.JSDOM(HTML, { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  w.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({ success: true }),
  });
  w.eval(BUNDLE);
  if (w.document.readyState === 'loading') await new Promise(r => w.document.addEventListener('DOMContentLoaded', r));
  return w;
}

function setup(w) {
  const d = w.document,
    ziel = d.createElement('div');
  ziel.innerHTML = `
    <div class="sc" id="karte" tabindex="0" role="button" data-click="stopEvent">
      <button id="innen" data-click="stopEvent">x</button></div>
    <table><tbody><tr id="zeile" tabindex="0" data-click="stopEvent"><td>1</td></tr></tbody></table>`;
  d.body.appendChild(ziel);
  const klicks = { karte: 0, row: 0 };
  d.getElementById('karte').addEventListener('click', e => {
    if (e.target.id === 'karte') klicks.karte++;
  });
  d.getElementById('zeile').addEventListener('click', () => {
    klicks.row++;
  });
  return klicks;
}
const taste = (w, el, key) =>
  el.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

test('cards and rows via keyboard', async t => {
  const w = await fenster();
  t.after(() => w.close());
  const d = w.document,
    k = setup(w);

  await t.test('Enter on a card', () => {
    taste(w, d.getElementById('karte'), 'Enter');
    assert.equal(k.karte, 1);
  });
  await t.test('space bar on role="button"', () => {
    taste(w, d.getElementById('karte'), ' ');
    assert.equal(k.karte, 2);
  });
  await t.test('table row: Enter yes, space bar no', () => {
    taste(w, d.getElementById('zeile'), 'Enter');
    taste(w, d.getElementById('zeile'), ' ');
    assert.equal(k.row, 1);
  });
  await t.test('a button in the card does not trigger the card', () => {
    taste(w, d.getElementById('innen'), 'Enter');
    assert.equal(k.karte, 2);
  });
});
