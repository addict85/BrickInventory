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
const { openUi, reiter, warte } = require('./helpers/ui');

const STYLE = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
const withStyle = w =>
  w.document.addEventListener('DOMContentLoaded', () => {
    const s = w.document.createElement('style');
    s.textContent = STYLE;
    w.document.head.append(s);
  });
const sichtbar = (w, sel) =>
  [...w.document.querySelectorAll(sel)].filter(e => {
    for (let x = e; x && x.nodeType === 1; x = x.parentElement)
      if (w.getComputedStyle(x).display === 'none') return false;
    return true;
  });

test('add set exactly once', async () => {
  const { w, d } = await openUi({}, { vorher: withStyle });
  try {
    await warte(() => !!d.querySelector('#gallery .empty.leer'));
    const knoepfe = sichtbar(w, '#tab-gallery [data-click="oeffneErfassen"][data-arg="set"]');
    assert.equal(knoepfe.length, 1);
    assert.ok(knoepfe[0].closest('#gallery .empty.leer'), 'der sichtbare Knopf steht nicht im Leerzustand');
    assert.match(d.querySelector('#gallery .empty.leer').textContent, /Noch keine Sets/);
  } finally {
    w.close();
  }
});

test('parts and minifigures likewise', async () => {
  const { w } = await openUi({}, { vorher: withStyle });
  try {
    for (const [tab, art] of [
      ['parts', 'part'],
      ['minifigs', 'fig'],
    ]) {
      await reiter(w, tab);
      await warte(() => !!w.document.querySelector(`#tab-${tab} .empty.leer`));
      assert.equal(sichtbar(w, `#tab-${tab} [data-click="oeffneErfassen"][data-arg="${art}"]`).length, 1, tab);
    }
  } finally {
    w.close();
  }
});
