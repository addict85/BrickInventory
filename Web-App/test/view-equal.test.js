/**
 * Sets, parts and minifigures switch the view with the same buttons
 * (cards/table) instead of partly with buttons, partly with a select field. On the
 * real bundle in jsdom.
 *
 * Counter-check (measured on 28.10.2026): the change event not triggered in
 * ansichtWaehlen() → red: “parts: the table loads the set mapping”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, switchTab } = require('./helpers/ui');

test('the same view buttons in all three tabs', async () => {
  const { w, d } = await openUi();
  try {
    for (const tab of ['tab-gallery', 'tab-parts', 'tab-minifigs']) {
      const group = d.querySelector(`#${tab} .vtgl[role="group"]`);
      assert.ok(group, `${tab}: no view buttons`);
      assert.equal(group.querySelectorAll('button.vb[aria-pressed]').length, 2, `${tab}: not cards and table`);
    }
    assert.equal(
      d.querySelectorAll('select#parts-view:not(.vh), select#figs-view:not(.vh)').length,
      0,
      'a visible select field for the view remained',
    );
  } finally {
    w.close();
  }
});

test('parts: the table loads the set mapping', async () => {
  const { w, d, calls, settle } = await openUi();
  try {
    await switchTab(w, 'parts');
    assert.ok(await settle(), 'the tab does not finish loading');
    const prior = calls.length;
    const button = d.querySelector('[data-click="chooseView"][data-arg="parts-view"][data-arg2="table"]');
    button.click();
    await settle();
    assert.ok(
      calls.slice(prior).some(a => /\/v2\/parts\?.*with_sets=1/.test(a.url)),
      'the switch did not reload',
    );
    assert.equal(d.getElementById('parts-view').value, 'table');
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.equal(d.querySelector('[data-arg="parts-view"][data-arg2="grid"]').getAttribute('aria-pressed'), 'false');
  } finally {
    w.close();
  }
});
