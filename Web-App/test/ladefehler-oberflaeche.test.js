/**
 * Ladefehler und fehlende Verbindung — am echten Bündel in jsdom.
 *
 *   - Antwortet der Server beim ersten Laden einer Liste mit einem Fehler,
 *     steht der Grund mit „Erneut versuchen“ da, nicht „Noch keine Sets“.
 *     Der Knopf lädt neu. Dasselbe gilt für Merkliste, Teile, Minifiguren,
 *     Katalog und Finanzen (ein Baustein: fehlerZustand).
 *   - Scheitert ein späteres Neuladen, bleibt die alte Liste stehen; eine
 *     Meldung sagt, dass es der letzte Stand ist.
 *   - Ein Netzfehler beim Erfassen meldet „Server nicht erreichbar“ statt
 *     des Browsertexts „Failed to fetch“.
 *   - Ohne Verbindung steht ein Band „Keine Verbindung – Anzeige vom …“; mit
 *     Verbindung verschwindet es.
 *
 * Gegenproben (am 29.10.2026 gemessen):
 *   A  in loadGallery den Aufruf von listeLadefehler entfernt → rot:
 *      „Sammlung: Serverfehler beim ersten Laden“ (es stand „Noch keine Sets“)
 *      und „… alte Liste bleibt stehen“ (0 statt 2 Kacheln)
 *   B  in ladeMerkliste wieder `d?.merkposten || []` ohne Prüfung → rot:
 *      „jede Liste zeigt ihren Ladefehler“ (Merkliste)
 *   C  in doAddSet wieder toast(e.message) → rot: „Netzfehler beim Erfassen“
 *      („Failed to fetch“)
 *   D  den offline-Hörer in 01-core.js entfernt → rot: „Band ohne Verbindung“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, warte, takt } = require('./helpers/oberflaeche');

const SERVERFEHLER = { $status: 500, success: false, error: 'Interner Fehler' };
const ZWEI_SETS = { success: true, total: 2, themes: [], sets: [
  { set_number: '10294-1', name: 'Titanic', quantity: 1, year: 2021 },
  { set_number: '42143-1', name: 'Ferrari', quantity: 1, year: 2022 },
] };

test('Sammlung: Serverfehler beim ersten Laden zeigt den Grund und „Erneut versuchen“', async () => {
  let antwort = SERVERFEHLER;
  const { w, d } = await oeffneOberflaeche({ '/v1/sets': () => antwort });
  try {
    await warte(() => d.querySelector('#gallery .fehler-zustand'));
    const box = d.querySelector('#gallery .fehler-zustand');
    assert.ok(box, `Kein Fehlerzustand: „${d.getElementById('gallery').textContent.trim().slice(0, 80)}“`);
    assert.match(box.textContent, /Interner Fehler/);
    assert.doesNotMatch(d.getElementById('gallery').textContent, /Noch keine Sets/);
    const knopf = box.querySelector('button[data-click="loadGallery"]');
    assert.match(knopf.textContent, /Erneut versuchen/);
    antwort = ZWEI_SETS;
    knopf.click();
    await warte(() => d.querySelectorAll('#gallery .sc').length === 2);
    assert.equal(d.querySelectorAll('#gallery .sc').length, 2, 'Erneut versuchen lädt nicht neu');
  } finally { w.close(); }
});

test('Sammlung: scheitert das Neuladen, bleibt die alte Liste stehen', async () => {
  let antwort = ZWEI_SETS;
  const { w, d } = await oeffneOberflaeche({ '/v1/sets': () => antwort });
  try {
    await warte(() => d.querySelectorAll('#gallery .sc').length === 2);
    antwort = SERVERFEHLER;
    await reiter(w, 'gallery');
    await warte(() => d.querySelector('#toasts .toast.error'));
    assert.equal(d.querySelectorAll('#gallery .sc').length, 2, 'die alte Liste ist weg');
    assert.match(d.querySelector('#toasts .toast.error').textContent, /Interner Fehler.*letzte Stand/);
  } finally { w.close(); }
});

test('jede Liste zeigt ihren Ladefehler mit demselben Baustein', async () => {
  const kaputt = () => { throw new TypeError('Failed to fetch'); };
  const { w, d } = await oeffneOberflaeche({
    '/v1/wanted': kaputt, '/v1/parts': kaputt, '/v1/minifigs': kaputt,
    '/v1/catalog/sets': kaputt, '/v1/finance/valuation': kaputt,
  });
  try {
    for (const [tab, ziel] of [['wanted', '#mk-list'], ['parts', '#parts-main'], ['minifigs', '#figs-list'],
                              ['catalog', '#catalog-grid'], ['finance', '#fin-tbl']]) {
      await reiter(w, tab);
      await warte(() => d.querySelector(`${ziel} .fehler-zustand`));
      const box = d.querySelector(`${ziel} .fehler-zustand`);
      assert.ok(box, `${tab}: kein Fehlerzustand — „${d.querySelector(ziel)?.textContent.trim().slice(0, 60)}“`);
      assert.match(box.textContent, /Server nicht erreichbar/, `${tab}: Grund fehlt`);
      assert.doesNotMatch(box.textContent, /Failed to fetch/, `${tab}: roher Browsertext`);
      assert.ok(box.querySelector('button[data-click]'), `${tab}: kein „Erneut versuchen“`);
    }
  } finally { w.close(); }
});

test('Netzfehler beim Erfassen: „Server nicht erreichbar“ statt „Failed to fetch“', async () => {
  const { w, d } = await oeffneOberflaeche({ '/v1/sets/add-stream': () => { throw new TypeError('Failed to fetch'); } });
  try {
    d.querySelector('button[data-click="oeffneErfassen"][data-arg="set"]').click();
    d.getElementById('add-num').value = '10497-1';
    d.getElementById('btn-add').click();
    await warte(() => d.querySelector('#toasts .toast.error'));
    const text = d.querySelector('#toasts .toast.error')?.textContent || '';
    assert.match(text, /Server nicht erreichbar/);
    assert.doesNotMatch(text, /Failed to fetch/);
  } finally { w.close(); }
});

test('Band ohne Verbindung: „Keine Verbindung – Anzeige vom …“', async () => {
  const { w, d } = await oeffneOberflaeche();
  try {
    const band = d.getElementById('offline-band');
    assert.equal(band.hidden, true, 'das Band steht schon mit Verbindung da');
    Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => false });
    w.dispatchEvent(new w.Event('offline'));
    await takt(10);
    assert.equal(band.hidden, false, 'ohne Verbindung kein Band');
    assert.match(band.textContent, /^Keine Verbindung – Anzeige vom \d{2}\.\d{2}\.\d{4}/);
    Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => true });
    w.dispatchEvent(new w.Event('online'));
    await takt(10);
    assert.equal(band.hidden, true, 'das Band bleibt nach der Rückkehr stehen');
  } finally { w.close(); }
});
