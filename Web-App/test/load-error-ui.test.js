/**
 * Load errors and missing connection — on the real bundle in jsdom.
 *
 * Counter-checks (measured on 29.10.2026):
 *   A  the call of listLoadError removed in loadGallery → red:
 *      “collection: a server error on the first load” (it said „Noch keine Sets“)
 *      and “… the old list stays” (0 instead of 2 tiles)
 *   B  in loadWanted again `d?.merkposten || []` without a check → red:
 *      “every list shows its load error” (wishlist)
 *   C  in doAddSet again toast(e.message) → red: “network error when capturing”
 *      („Failed to fetch“)
 *   D  the offline listener in verbindung.js removed → red: “banner without connection”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, warte, takt } = require('./helpers/ui');

const SERVERFEHLER = { $status: 500, success: false, error: 'Interner Fehler', code: 'internal_error' };
const TWO_SETS = {
  success: true,
  total: 2,
  themes: [],
  sets: [
    { set_number: '10294-1', name: 'Titanic', quantity: 1, year: 2021 },
    { set_number: '42143-1', name: 'Ferrari', quantity: 1, year: 2022 },
  ],
};

test('collection: a server error on the first load shows the reason and "try again"', async () => {
  /** @type {object} */
  let response = SERVERFEHLER;
  const { w, d } = await openUi({ '/v2/sets': () => response });
  try {
    await warte(() => d.querySelector('#gallery .error-state'));
    const box = d.querySelector('#gallery .error-state');
    assert.ok(box, `Kein Fehlerzustand: „${d.getElementById('gallery').textContent.trim().slice(0, 80)}“`);
    assert.match(box.textContent, /Interner Fehler/);
    assert.doesNotMatch(d.getElementById('gallery').textContent, /Noch keine Sets/);
    const knopf = box.querySelector('button[data-click="loadGallery"]');
    assert.match(knopf.textContent, /Erneut versuchen/);
    response = TWO_SETS;
    knopf.click();
    await warte(() => d.querySelectorAll('#gallery .sc').length === 2);
    assert.equal(d.querySelectorAll('#gallery .sc').length, 2, 'Erneut versuchen lädt nicht neu');
  } finally {
    w.close();
  }
});

test('collection: if reloading fails, the old list stays', async () => {
  /** @type {object} */
  let response = TWO_SETS;
  const { w, d } = await openUi({ '/v2/sets': () => response });
  try {
    await warte(() => d.querySelectorAll('#gallery .sc').length === 2);
    response = SERVERFEHLER;
    await reiter(w, 'gallery');
    await warte(() => d.querySelector('#toasts .toast.error'));
    assert.equal(d.querySelectorAll('#gallery .sc').length, 2, 'die alte Liste ist weg');
    assert.match(
      d.querySelector('#toasts .toast.error').textContent,
      /letzte Stand bleibt sichtbar.*Details.*Server konnte die Daten gerade nicht liefern/,
    );
  } finally {
    w.close();
  }
});

test('every list shows its load error with the same building block', async () => {
  const kaputt = () => {
    throw new TypeError('Failed to fetch');
  };
  const { w, d } = await openUi({
    '/v2/wanted': kaputt,
    '/v2/parts': kaputt,
    '/v2/minifigs': kaputt,
    '/v2/catalog/sets': kaputt,
    '/v2/finance/valuation': kaputt,
  });
  try {
    for (const [tab, ziel] of [
      ['wanted', '#mk-list'],
      ['parts', '#parts-main'],
      ['minifigs', '#figs-list'],
      ['catalog', '#catalog-grid'],
      // Since round 24 (M2) at the top of the chart box, as long as nothing was loaded yet.
      ['finance', '#portfolio-chart'],
    ]) {
      await reiter(w, tab);
      await warte(() => d.querySelector(`${ziel} .error-state`));
      const box = d.querySelector(`${ziel} .error-state`);
      assert.ok(box, `${tab}: kein Fehlerzustand — „${d.querySelector(ziel)?.textContent.trim().slice(0, 60)}“`);
      assert.match(box.textContent, /Keine Verbindung zum Server/, `${tab}: Grund fehlt`);
      assert.doesNotMatch(box.textContent, /Failed to fetch/, `${tab}: roher Browsertext`);
      assert.ok(box.querySelector('button[data-click]'), `${tab}: kein „Erneut versuchen“`);
    }
  } finally {
    w.close();
  }
});

test('network error when capturing: "no connection to the server" instead of "Failed to fetch"', async () => {
  const { w, d } = await openUi({
    '/v2/sets/add-stream': () => {
      throw new TypeError('Failed to fetch');
    },
  });
  try {
    d.querySelector('button[data-click="openCapture"][data-arg="set"]').click();
    d.getElementById('add-num').value = '10497-1';
    d.getElementById('btn-add').click();
    await warte(() => d.querySelector('#toasts .toast.error'));
    const text = d.querySelector('#toasts .toast.error')?.textContent || '';
    assert.match(text, /Keine Verbindung zum Server/);
    assert.doesNotMatch(text, /Failed to fetch/);
  } finally {
    w.close();
  }
});

test('banner without connection: "no connection since …"', async () => {
  const { w, d } = await openUi();
  try {
    const band = d.getElementById('offline-band');
    assert.equal(band.hidden, true, 'das Band steht schon mit Verbindung da');
    Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => false });
    w.dispatchEvent(new w.Event('offline'));
    await takt(10);
    assert.equal(band.hidden, false, 'ohne Verbindung kein Band');
    assert.match(band.textContent, /^Keine Verbindung seit heute, \d{2}:\d{2}\./);
    Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => true });
    w.dispatchEvent(new w.Event('online'));
    await takt(10);
    assert.equal(band.hidden, true, 'das Band bleibt nach der Rückkehr stehen');
  } finally {
    w.close();
  }
});
