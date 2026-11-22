/**
 * Address and history in Chrome: every view has its address, “back”
 * leads to the previous view and closes open dialogs, a reload or
 * a link opens the named view, filters stand in it as a query.
 *
 * Counter-checks (measured 03.11.2026, each alone):
 *   A  reportView(tab) removed in bindTabs → red: “tabs write the
 *      address” (stays “#/sammlung”) and the three following
 *   B  beiDialogWechsel(dialogSwitched) removed in router.js → red:
 *      “back closes the dialog” (dialog stays, view switches)
 *   C  routeOnStart() removed in showApp → red: all four (the router
 *      never starts; “reload” shows the collection instead of the finances)
 *   D  reportFilter() removed in the event of the filter fields → red: “filter in
 *      the address”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, warte } = require('./helpers/app-browser');
const { patternCollection } = require('./helpers/inventory');

const CONDITION = `({ url: location.hash, ansicht: document.querySelector('.tab.active')?.id,
  dialoge: [...document.querySelectorAll('.ovl.open')].map(o => o.id) })`;

test('address and history', { timeout: 180_000 }, async t => {
  const app = await startApp(t, { name: `verlauf_${process.pid}`, holding: patternCollection });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, bis, ruhig } = app;
  // Startup loads settings and prices afterwards; only then is the state fixed.
  await ruhig();
  const condition = () => b.auswerten(CONDITION);
  const zurueck = async () => {
    await b.auswerten('history.back(); true');
    await warte(400);
  };

  await t.test('tabs write the address', async () => {
    await b.auswerten(`document.querySelector('.ntab[data-tab="finance"]').click(); true`);
    await b.auswerten(`document.querySelector('.ntab[data-tab="wanted"]').click(); true`);
    assert.equal((await condition()).url, '#/merkliste');
    await zurueck();
    assert.deepEqual(await condition(), { url: '#/finanzen', ansicht: 'tab-finance', dialoge: [] });
  });

  await t.test('back closes the dialog', async () => {
    await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
    await bis(`!!document.querySelector('#gallery [data-click="openModal"]')`, 'Kacheln');
    await b.auswerten(`document.querySelector('#gallery [data-click="openModal"]').click(); true`);
    await ruhig();
    const open = await condition();
    assert.deepEqual(open.dialoge, ['set-modal']);
    assert.match(open.url, /^#\/sammlung\/set\/\d+-\d+$/);
    await zurueck();
    assert.deepEqual(await condition(), { url: '#/sammlung', ansicht: 'tab-gallery', dialoge: [] });
    // Closed with the button: the dialog's entry drops, back leads to the previous view.
    await b.auswerten(`history.forward(); true`);
    await warte(800);
    assert.deepEqual((await condition()).dialoge, ['set-modal']);
    await b.auswerten(`document.querySelector('#set-modal [data-dialog-close]').click(); true`);
    await warte(400);
    await zurueck();
    assert.equal((await condition()).ansicht, 'tab-finance');
  });

  await t.test('filters in the address', async () => {
    await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
    await b.auswerten(
      `const f = document.getElementById('gs'); f.value = 'Tree'; f.dispatchEvent(new Event('input', { bubbles: true })); true`,
    );
    assert.equal((await condition()).url, '#/sammlung?suche=Tree');
  });

  await t.test('reloading opens the view of the address', async () => {
    await b.auswerten(`location.hash = '#/finanzen'; location.reload(); true`);
    await ruhig();
    await bis(
      `getComputedStyle(document.getElementById('app')).display !== 'none' && !!document.querySelector('.tab.active')`,
      'App nach Neuladen',
      300,
    );
    await bis(`document.querySelector('.tab.active')?.id === 'tab-finance'`, 'Finanzen nach Neuladen');
    await b.auswerten(`location.hash = '#/sammlung?suche=Tree'; location.reload(); true`);
    await ruhig();
    await bis(
      `document.querySelector('.tab.active')?.id === 'tab-gallery' && document.getElementById('gs').value === 'Tree'`,
      'Suche nach Neuladen',
    );
  });
});
