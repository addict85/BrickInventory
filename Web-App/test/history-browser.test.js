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
const { startApp, sleep } = require('./helpers/app-browser');
const { patternCollection } = require('./helpers/inventory');

const CONDITION = `({ url: location.hash, viewName: document.querySelector('.tab.active')?.id,
  dialogs: [...document.querySelectorAll('.ovl.open')].map(o => o.id) })`;

test('address and history', { timeout: 180_000 }, async t => {
  const app = await startApp(t, { name: `verlauf_${process.pid}`, holding: patternCollection });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, until, settle } = app;
  // Startup loads settings and prices afterwards; only then is the state fixed.
  await settle();
  const condition = () => b.evaluate(CONDITION);
  const back = async () => {
    await b.evaluate('history.back(); true');
    await sleep(400);
  };

  await t.test('tabs write the address', async () => {
    await b.evaluate(`document.querySelector('.ntab[data-tab="finance"]').click(); true`);
    await b.evaluate(`document.querySelector('.ntab[data-tab="wanted"]').click(); true`);
    assert.equal((await condition()).url, '#/merkliste');
    await back();
    assert.deepEqual(await condition(), { url: '#/finanzen', viewName: 'tab-finance', dialogs: [] });
  });

  await t.test('back closes the dialog', async () => {
    await b.evaluate(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
    await until(`!!document.querySelector('#gallery [data-click="openModal"]')`, 'Kacheln');
    await b.evaluate(`document.querySelector('#gallery [data-click="openModal"]').click(); true`);
    await settle();
    const open = await condition();
    assert.deepEqual(open.dialogs, ['set-modal']);
    assert.match(open.url, /^#\/sammlung\/set\/\d+-\d+$/);
    await back();
    assert.deepEqual(await condition(), { url: '#/sammlung', viewName: 'tab-gallery', dialogs: [] });
    // Closed with the button: the dialog's entry drops, back leads to the previous view.
    await b.evaluate(`history.forward(); true`);
    await sleep(800);
    assert.deepEqual((await condition()).dialogs, ['set-modal']);
    await b.evaluate(`document.querySelector('#set-modal [data-dialog-close]').click(); true`);
    await sleep(400);
    await back();
    assert.equal((await condition()).viewName, 'tab-finance');
  });

  await t.test('filters in the address', async () => {
    await b.evaluate(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
    await b.evaluate(
      `const f = document.getElementById('gs'); f.value = 'Tree'; f.dispatchEvent(new Event('input', { bubbles: true })); true`,
    );
    assert.equal((await condition()).url, '#/sammlung?suche=Tree');
  });

  await t.test('reloading opens the view of the address', async () => {
    await b.evaluate(`location.hash = '#/finanzen'; location.reload(); true`);
    await settle();
    await until(
      `getComputedStyle(document.getElementById('app')).display !== 'none' && !!document.querySelector('.tab.active')`,
      'App after reload',
      300,
    );
    await until(`document.querySelector('.tab.active')?.id === 'tab-finance'`, 'Finances after reload');
    await b.evaluate(`location.hash = '#/sammlung?suche=Tree'; location.reload(); true`);
    await settle();
    await until(
      `document.querySelector('.tab.active')?.id === 'tab-gallery' && document.getElementById('gs').value === 'Tree'`,
      'Search after reload',
    );
  });
});
