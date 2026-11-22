/**
 * Offline a list shows the last loaded state of this tab instead of
 * an error, and banner and content do not contradict each other: if a list has
 * never loaded, it says „Keine Verbindung“, its „Erneut versuchen“ stays
 * operable (it only reads) and loads by itself as soon as the connection is back …
 *
 * Counter-checks (measured on 03.11.2026):
 *   A  offZwischenspeicher() not asked in api() → red: „Merkliste: letzter Stand“
 *   B  [data-reading] removed from NOT_LOCK → red: “try again stays operable”
 *   C  the automatic reloading removed in showConnection(true) → red: “loads by itself”
 *   D  the rule label:has(> input[data-offline-locked]) removed → red: “CSV label locked”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openUi, reiter, warte } = require('./helpers/ui');

const STYLE = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
const withStyle = w =>
  w.document.addEventListener('DOMContentLoaded', () => {
    const s = w.document.createElement('style');
    s.textContent = STYLE;
    w.document.head.append(s);
  });
const MERK = {
  success: true,
  merkposten: [{ id: 1, set_number: '10497-1', name: 'Galaxie-Forscher', condition: 'N', quantity: 1 }],
};

function netz(w, an) {
  Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => an });
  w.dispatchEvent(new w.Event(an ? 'online' : 'offline'));
}

test('wishlist: last state instead of an error, even after reloading the page', async () => {
  // First visit with network; the second (as after F5) without, with the storage of this tab.
  const erst = await openUi({ '/v1/wanted': MERK });
  await reiter(erst.w, 'wanted');
  await warte(() => erst.d.querySelector('#mk-list .mk-row'));
  const speicher = Object.fromEntries(
    Object.keys(erst.w.sessionStorage).map(k => [k, erst.w.sessionStorage.getItem(k)]),
  );
  erst.w.close();
  const { w, d, ruhig } = await openUi(
    {
      '/v1/wanted': () => {
        throw new TypeError('Failed to fetch');
      },
    },
    {
      vorher: w2 => {
        for (const [k, v] of Object.entries(speicher)) w2.sessionStorage.setItem(k, v);
      },
    },
  );
  try {
    netz(w, false);
    await reiter(w, 'wanted');
    await ruhig();
    assert.equal(d.querySelector('#mk-list .error-state'), null, 'Merkliste: letzter Stand');
    assert.match(d.getElementById('mk-list').textContent, /Galaxie-Forscher/);
    assert.match(d.getElementById('offline-band').textContent, /^Keine Verbindung/);
  } finally {
    w.close();
  }
});

test('never loaded: "no connection", try again stays operable and loads by itself', async t => {
  let offline = true;
  const { w, d } = await openUi(
    {
      '/v1/wanted': () => {
        if (offline) throw new TypeError('Failed to fetch');
        return MERK;
      },
    },
    { vorher: withStyle },
  );
  try {
    netz(w, false);
    await reiter(w, 'wanted');
    await warte(() => d.querySelector('#mk-list .error-state'));
    const box = d.querySelector('#mk-list .error-state');
    await t.test('Text', () => assert.match(box.textContent, /Keine Verbindung zum Server/));
    await t.test('try again stays operable', () =>
      assert.equal(box.querySelector('button[data-click]').disabled, false),
    );
    await t.test('CSV label locked', () => {
      const label = d.querySelector('#tab-wanted label:has(> input[type=file])');
      assert.ok(label, 'kein Datei-Label in der Merkliste');
      assert.equal(w.getComputedStyle(label).pointerEvents, 'none');
    });
    offline = false;
    netz(w, true);
    await warte(() => d.querySelector('#mk-list .mk-row'));
    await t.test('loads by itself', () => assert.ok(d.querySelector('#mk-list .mk-row')));
  } finally {
    w.close();
  }
});
