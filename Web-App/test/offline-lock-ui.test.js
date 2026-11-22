/**
 * Without a connection writing buttons are locked and name the banner as
 * the reason, instead of showing an error message after the click. When the
 * connection comes back, they are free again. On the real bundle in jsdom.
 *
 * Counter-checks (measured 02.11.2026, each on its own, bundle rebuilt):
 *   A  lockWrites(true) removed in showConnection → red: “offline:
 *      adding locked”
 *   B  MutationObserver not started → red: “redrawn buttons too”
 *   C  lockWrites(false) removed on coming back → red: “online: free again”
 *   D  (02.11.) old single list instead of schreibt() (only bp/bd and five
 *      name patterns, #rb-hint excepted) → red: “all writing
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
    const add = d.querySelector('#tab-gallery button[data-click="openCapture"]');
    const filter = d.querySelector('#tab-gallery .filter-button');
    assert.ok(add && filter);
    Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => false });
    w.dispatchEvent(new w.Event('offline'));
    await takt(10);
    await t.test('offline: adding locked', () => {
      assert.equal(d.getElementById('offline-band').hidden, false);
      assert.equal(add.disabled, true);
      assert.match(add.getAttribute('aria-describedby') || '', /offline-band/);
      assert.equal(filter.disabled, false, 'reading stays possible');
      assert.match(d.getElementById('offline-band').textContent, /gesperrt/);
    });
    await t.test('all writing controls, reading stays free', async () => {
      const import_ = d.querySelector('#tab-gallery .import-menu > summary');
      assert.equal(import_.getAttribute('aria-disabled'), 'true', 'Importieren');
      import_.click();
      assert.equal(import_.parentElement.open, false, 'import opens anyway');
      assert.equal(d.querySelector('#rb-hint .btn.bp').disabled, false, 'entering the key only leads to the settings');
      assert.equal(d.querySelector('#rb-hint .hint-close').disabled, false, 'close the hint');
      const dateien = [...d.querySelectorAll('input[type=file]')];
      assert.ok(dateien.length >= 3 && dateien.every(f => f.disabled), 'Datei-Wahl');
      const div = d.createElement('div');
      div.innerHTML =
        '<button class="v-btn" data-click="editVoucher">B</button><button class="v-btn" data-click="copyVoucher">K</button>';
      d.body.appendChild(div);
      await takt(10);
      assert.deepEqual(
        [...div.querySelectorAll('button')].map(k => k.disabled),
        [true, false],
      );
      for (const sel of ['.ntab[data-tab="finance"]', '#btn-umenu', '.umenu-item[data-arg="profile"]'])
        assert.equal(d.querySelector(sel).disabled, false, sel);
    });
    await t.test('redrawn buttons too', async () => {
      const div = d.createElement('div');
      div.innerHTML = '<button class="btn bp" data-click="saveAlert">Speichern</button>';
      d.body.appendChild(div);
      await takt(10);
      assert.equal(div.querySelector('button').disabled, true);
    });
    await t.test('online: free again', async () => {
      Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => true });
      w.dispatchEvent(new w.Event('online'));
      await takt(10);
      assert.equal(add.disabled, false);
      assert.equal(add.hasAttribute('aria-describedby'), false);
      assert.equal(d.querySelector('#tab-gallery .import-menu > summary').hasAttribute('aria-disabled'), false);
      assert.equal(d.getElementById('offline-band').hidden, true);
    });
  } finally {
    w.close();
  }
});
