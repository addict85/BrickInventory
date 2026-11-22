/**
 * Without a connection writing buttons are locked and name the banner as
 * the reason, instead of showing an error message after the click. When the
 * connection comes back, they are free again. On the real bundle in jsdom.
 *
 * Counter-checks (measured 02.11.2026, each on its own, bundle rebuilt):
 *   A  schreibenSperren(true) removed in showConnection → red: “offline:
 *      adding locked”
 *   B  MutationObserver not started → red: “redrawn buttons too”
 *   C  schreibenSperren(false) removed on coming back → red: “online: free again”
 *   D  (02.11.) old single list instead of schreibt() (only bp/bd and five
 *      name patterns, #rb-hinweis excepted) → red: “all writing
 *      controls” (import, enter key, file choice, edit)
 *   E  (08.11.) old rule back (bp/bd always, otherwise name regex) → red:
 *      “all writing controls” (enter key locked)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, takt } = require('./helpers/ui');

test('offline: writing buttons locked', async t => {
  const { w, d } = await openUi();
  try {
    const hinzu = d.querySelector('#tab-gallery button[data-click="oeffneErfassen"]');
    const filter = d.querySelector('#tab-gallery .filter-knopf');
    assert.ok(hinzu && filter);
    Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => false });
    w.dispatchEvent(new w.Event('offline'));
    await takt(10);
    await t.test('offline: adding locked', () => {
      assert.equal(d.getElementById('offline-band').hidden, false);
      assert.equal(hinzu.disabled, true);
      assert.match(hinzu.getAttribute('aria-describedby') || '', /offline-band/);
      assert.equal(filter.disabled, false, 'Lesen bleibt möglich');
      assert.match(d.getElementById('offline-band').textContent, /gesperrt/);
    });
    await t.test('all writing controls, reading stays free', async () => {
      const import_ = d.querySelector('#tab-gallery .import-menue > summary');
      assert.equal(import_.getAttribute('aria-disabled'), 'true', 'Importieren');
      import_.click();
      assert.equal(import_.parentElement.open, false, 'Importieren öffnet trotzdem');
      assert.equal(
        d.querySelector('#rb-hinweis .btn.bp').disabled,
        false,
        'Schlüssel eintragen führt nur zu den Einstellungen',
      );
      assert.equal(d.querySelector('#rb-hinweis .hinweis-zu').disabled, false, 'Hinweis schliessen');
      const dateien = [...d.querySelectorAll('input[type=file]')];
      assert.ok(dateien.length >= 3 && dateien.every(f => f.disabled), 'Datei-Wahl');
      const div = d.createElement('div');
      div.innerHTML =
        '<button class="v-btn" data-click="gutscheinBearbeiten">B</button><button class="v-btn" data-click="gutscheinKopieren">K</button>';
      d.body.appendChild(div);
      await takt(10);
      assert.deepEqual(
        [...div.querySelectorAll('button')].map(k => k.disabled),
        [true, false],
      );
      for (const sel of ['.ntab[data-tab="finance"]', '#btn-umenu', '.umenu-item[data-arg="profil"]'])
        assert.equal(d.querySelector(sel).disabled, false, sel);
    });
    await t.test('redrawn buttons too', async () => {
      const div = d.createElement('div');
      div.innerHTML = '<button class="btn bp" data-click="speichereAlarm">Speichern</button>';
      d.body.appendChild(div);
      await takt(10);
      assert.equal(div.querySelector('button').disabled, true);
    });
    await t.test('online: free again', async () => {
      Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => true });
      w.dispatchEvent(new w.Event('online'));
      await takt(10);
      assert.equal(hinzu.disabled, false);
      assert.equal(hinzu.hasAttribute('aria-describedby'), false);
      assert.equal(d.querySelector('#tab-gallery .import-menue > summary').hasAttribute('aria-disabled'), false);
      assert.equal(d.getElementById('offline-band').hidden, true);
    });
  } finally {
    w.close();
  }
});
