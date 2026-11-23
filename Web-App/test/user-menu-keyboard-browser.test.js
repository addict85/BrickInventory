/**
 * The user menu behaves like a menu following the APG pattern „Menu
 * Button“: Enter and arrow open it with focus on an entry, arrows,
 * Home and End move, Escape closes and returns the focus to the button,
 * a choice puts it on the heading of the new page. Real
 * key presses via the DevTools protocol in Chrome.
 *
 * Counter-checks (measured 02.11.2026, each on its own, bundle rebuilt):
 *   A  openMenu() without focus on the entry → red: “Enter opens and
 *      focuses the first entry”
 *   B  arrow handling removed in the keydown listener → red: “arrow down moves”
 *   C  closeMenu(true) on Escape again without an argument → red: “Escape
 *      closes, focus back on the button”
 *   D  focusOnTitle() removed in openView → red: “choosing focuses the
 *      heading of the view”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, sleep } = require('./helpers/app-browser');
const { patternCollection } = require('./helpers/inventory');

const KEYS = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, Home: 36, End: 35, Tab: 9 };

test('user menu: keyboard following the menu pattern', { timeout: 120_000 }, async t => {
  const app = await startApp(t, { name: `umenu_${process.pid}`, holding: patternCollection });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, settle } = app;
  // The startup loads settings and prices afterwards; only then is the state fixed.
  await settle();
  // The setup wizard is a dialog and would catch Escape.
  const taste = async key => {
    const k = { key, code: key, windowsVirtualKeyCode: KEYS[key] };
    await b.tab('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k });
    if (key === 'Enter') await b.tab('Input.dispatchKeyEvent', { type: 'char', text: '\r', ...k });
    await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
    await sleep(60);
  };
  const focused = () =>
    b.evaluate(`(() => { const a = document.activeElement;
    return a.id || a.getAttribute('data-arg') || a.className || a.tagName; })()`);
  const open = () =>
    b.evaluate(`document.getElementById('umenu-pop').style.display !== 'none'
    && document.getElementById('btn-umenu').getAttribute('aria-expanded') === 'true'`);
  const entries = await b.evaluate(`[...document.querySelectorAll('#umenu-pop [role=menuitem]')]
    .filter(e => e.style.display !== 'none').map(e => e.id || e.getAttribute('data-arg'))`);
  assert.ok(entries.length >= 8, `too few entries: ${entries}`);

  await b.evaluate(`document.getElementById('btn-umenu').focus(); true`);
  await taste('Enter');
  await t.test('Enter opens and focuses the first entry', async () => {
    assert.equal(await open(), true);
    assert.equal(await focused(), entries[0]);
  });
  await t.test('arrow down moves, End and Home jump, arrow up wraps around', async () => {
    await taste('ArrowDown');
    assert.equal(await focused(), entries[1]);
    await taste('End');
    assert.equal(await focused(), entries.at(-1));
    await taste('Home');
    assert.equal(await focused(), entries[0]);
    await taste('ArrowUp');
    assert.equal(await focused(), entries.at(-1));
  });
  await t.test('Escape closes, focus back on the button', async () => {
    await taste('Escape');
    assert.equal(await open(), false);
    assert.equal(await focused(), 'btn-umenu');
  });
  await t.test('arrow up on the button opens with focus on the last entry', async () => {
    await taste('ArrowUp');
    assert.equal(await open(), true);
    assert.equal(await focused(), entries.at(-1));
    await taste('Escape');
  });
  await t.test('choosing focuses the heading of the view', async () => {
    await taste('Enter');
    await taste('ArrowDown'); // the second entry, a view without a tab
    await taste('Enter');
    await settle();
    assert.equal(await open(), false);
    assert.equal(
      await b.evaluate(`document.activeElement.classList.contains('ptitle')
      && !!document.activeElement.closest('#tab-${entries[1]}')`),
      true,
      `focus on ${await focused()}`,
    );
  });
});
