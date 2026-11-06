/**
 * Offline zeigt eine Liste den zuletzt geladenen Stand dieses Tabs statt
 * eines Fehlers, und Band und Inhalt widersprechen sich nicht: Hat eine Liste
 * nie geladen, sagt sie „Keine Verbindung“, ihr „Erneut versuchen“ bleibt
 * bedienbar (es liest nur) und lädt von selbst, sobald die Verbindung zurück …
 * Ausführlich: docs/begruendungen/test/offline-letzter-stand-oberflaeche.test.js.md#kopf
 *
 * Gegenproben (am 03.11.2026 gemessen):
 *   A  in api() ausZwischenspeicher() nicht gefragt → rot: „Merkliste: letzter Stand“
 *   B  [data-lesend] aus NICHT_SPERREN entfernt → rot: „Erneut versuchen bleibt bedienbar“
 *   C  das automatische Neuladen in zeigeVerbindung(true) entfernt → rot: „lädt von selbst“
 *   D  die Regel label:has(> input[data-offline-gesperrt]) entfernt → rot: „CSV-Label gesperrt“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { oeffneOberflaeche, reiter, warte, takt } = require('./helpers/oberflaeche');

const STIL = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
const mitStil = (w) => w.document.addEventListener('DOMContentLoaded', () => {
  const s = w.document.createElement('style'); s.textContent = STIL; w.document.head.append(s); });
const MERK = { success: true, merkposten: [{ id: 1, set_number: '10497-1', name: 'Galaxie-Forscher', condition: 'N', quantity: 1 }] };

function netz(w, an) {
  Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => an });
  w.dispatchEvent(new w.Event(an ? 'online' : 'offline'));
}

test('Merkliste: letzter Stand statt Fehler, auch nach dem Neuladen der Seite', async () => {
  // Erster Besuch mit Netz; der zweite (wie nach F5) ohne, mit dem Speicher dieses Tabs.
  const erst = await oeffneOberflaeche({ '/v1/wanted': MERK });
  await reiter(erst.w, 'wanted');
  await warte(() => erst.d.querySelector('#mk-list .mk-zeile'));
  const speicher = Object.fromEntries(Object.keys(erst.w.sessionStorage).map(k => [k, erst.w.sessionStorage.getItem(k)]));
  erst.w.close();
  const { w, d, ruhig } = await oeffneOberflaeche({ '/v1/wanted': () => { throw new TypeError('Failed to fetch'); } },
    { vorher: (w2) => { for (const [k, v] of Object.entries(speicher)) w2.sessionStorage.setItem(k, v); } });
  try {
    netz(w, false);
    await reiter(w, 'wanted');
    await ruhig();
    assert.equal(d.querySelector('#mk-list .fehler-zustand'), null, 'Merkliste: letzter Stand');
    assert.match(d.getElementById('mk-list').textContent, /Galaxie-Forscher/);
    assert.match(d.getElementById('offline-band').textContent, /^Keine Verbindung/);
  } finally { w.close(); }
});

test('nie geladen: „Keine Verbindung“, Erneut versuchen bleibt bedienbar und lädt von selbst', async (t) => {
  let offline = true;
  const { w, d } = await oeffneOberflaeche({ '/v1/wanted': () => { if (offline) throw new TypeError('Failed to fetch'); return MERK; } }, { vorher: mitStil });
  try {
    netz(w, false);
    await reiter(w, 'wanted');
    await warte(() => d.querySelector('#mk-list .fehler-zustand'));
    const box = d.querySelector('#mk-list .fehler-zustand');
    await t.test('Text', () => assert.match(box.textContent, /Keine Verbindung zum Server/));
    await t.test('Erneut versuchen bleibt bedienbar', () => assert.equal(box.querySelector('button[data-click]').disabled, false));
    await t.test('CSV-Label gesperrt', () => {
      const label = d.querySelector('#tab-wanted label:has(> input[type=file])');
      assert.ok(label, 'kein Datei-Label in der Merkliste');
      assert.equal(w.getComputedStyle(label).pointerEvents, 'none');
    });
    offline = false; netz(w, true);
    await warte(() => d.querySelector('#mk-list .mk-zeile'));
    await t.test('lädt von selbst', () => assert.ok(d.querySelector('#mk-list .mk-zeile')));
  } finally { w.close(); }
});
