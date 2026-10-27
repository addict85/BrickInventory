/**
 * Karten und Zeilen mit data-click lassen sich mit der Tastatur auslösen —
 * am echten Bündel in jsdom (public/js/11-actions.js).
 *
 *   Eingabe auf einer Karte mit tabindex       → Klick
 *   Leertaste auf role="button"               → Klick
 *   Leertaste auf einer Tabellenzeile          → nichts (sie rollt die Seite)
 *   Eingabe auf einem echten Knopf darin       → kein zweiter Klick der Karte
 *
 * Gegenprobe (am 27.10. gemessen): den keydown-Zuhörer in 11-actions.js
 * entfernt → rot: „Eingabe auf einer Karte".
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const jsdom = require(path.join(ROOT, 'node_modules', 'jsdom'));
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const BUNDLE = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.bundle.js'), 'utf8');

async function fenster() {
  const dom = new jsdom.JSDOM(HTML, { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  w.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' },
                           json: async () => ({ success: true }) });
  w.eval(BUNDLE);
  if (w.document.readyState === 'loading')
    await new Promise(r => w.document.addEventListener('DOMContentLoaded', r));
  return w;
}

function aufbau(w) {
  const d = w.document, ziel = d.createElement('div');
  ziel.innerHTML = `
    <div class="sc" id="karte" tabindex="0" role="button" data-click="stopEvent">
      <button id="innen" data-click="stopEvent">x</button></div>
    <table><tbody><tr id="zeile" tabindex="0" data-click="stopEvent"><td>1</td></tr></tbody></table>`;
  d.body.appendChild(ziel);
  const klicks = { karte: 0, zeile: 0 };
  d.getElementById('karte').addEventListener('click', e => { if (e.target.id === 'karte') klicks.karte++; });
  d.getElementById('zeile').addEventListener('click', () => { klicks.zeile++; });
  return klicks;
}
const taste = (w, el, key) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

test('Karten und Zeilen per Tastatur', async (t) => {
  const w = await fenster();
  t.after(() => w.close());
  const d = w.document, k = aufbau(w);

  await t.test('Eingabe auf einer Karte', () => {
    taste(w, d.getElementById('karte'), 'Enter');
    assert.equal(k.karte, 1);
  });
  await t.test('Leertaste auf role="button"', () => {
    taste(w, d.getElementById('karte'), ' ');
    assert.equal(k.karte, 2);
  });
  await t.test('Tabellenzeile: Eingabe ja, Leertaste nein', () => {
    taste(w, d.getElementById('zeile'), 'Enter');
    taste(w, d.getElementById('zeile'), ' ');
    assert.equal(k.zeile, 1);
  });
  await t.test('ein Knopf in der Karte löst die Karte nicht aus', () => {
    taste(w, d.getElementById('innen'), 'Enter');
    assert.equal(k.karte, 2);
  });
});
