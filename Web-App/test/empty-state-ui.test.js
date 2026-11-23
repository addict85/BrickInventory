/**
 * An empty collection shows “add set” visibly exactly once: as the
 * main button in the empty state; the button at the top steps back meanwhile. Likewise for
 * parts and minifigures. On the real bundle in jsdom, with styles.css.
 *
 * Counter-checks (measured 04.11.2026, each alone):
 *   A  rule .tab.sammlung-leer … > .btn.bp removed from styles.css → red:
 *      “add set exactly once” and “parts and minifigures likewise” (2 visible)
 *   B  button removed from the collection's empty state → red: “add
 *      set exactly once” (0 visible)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openUi, switchTab, waitFor } = require('./helpers/ui');

const STYLE = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
const withStyle = w =>
  w.document.addEventListener('DOMContentLoaded', () => {
    const s = w.document.createElement('style');
    s.textContent = STYLE;
    w.document.head.append(s);
  });
const visible = (w, sel) =>
  [...w.document.querySelectorAll(sel)].filter(e => {
    for (let x = e; x && x.nodeType === 1; x = x.parentElement)
      if (w.getComputedStyle(x).display === 'none') return false;
    return true;
  });

test('add set exactly once', async () => {
  const { w, d } = await openUi({}, { before: withStyle });
  try {
    await waitFor(() => !!d.querySelector('#gallery .empty.empty-state'));
    const buttonList = visible(w, '#tab-gallery [data-click="openCapture"][data-arg="set"]');
    assert.equal(buttonList.length, 1);
    assert.ok(buttonList[0].closest('#gallery .empty.empty-state'), 'the visible button is not in the empty state');
    assert.match(d.querySelector('#gallery .empty.empty-state').textContent, /Noch keine Sets/);
  } finally {
    w.close();
  }
});

test('parts and minifigures likewise', async () => {
  const { w } = await openUi({}, { before: withStyle });
  try {
    for (const [tab, kind] of [
      ['parts', 'part'],
      ['minifigs', 'fig'],
    ]) {
      await switchTab(w, tab);
      await waitFor(() => !!w.document.querySelector(`#tab-${tab} .empty.empty-state`));
      assert.equal(visible(w, `#tab-${tab} [data-click="openCapture"][data-arg="${kind}"]`).length, 1, tab);
    }
  } finally {
    w.close();
  }
});
