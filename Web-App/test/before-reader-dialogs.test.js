/**
 * Screen reader: every dialog has a name, and messages are announced —
 * errors immediately. On the real bundle in jsdom.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  aria-labelledby removed from set-modal → red: “every dialog has a
 *      name” (set-modal)
 *   B  role="alert" for error messages removed → red: “messages are
 *      announced”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte } = require('./helpers/ui');

test('every dialog has a name', async () => {
  const { w, d } = await openUi();
  try {
    const dialoge = [...d.querySelectorAll('[role="dialog"]')];
    assert.ok(dialoge.length >= 15, `nur ${dialoge.length} Dialoge gefunden`);
    const ohne = dialoge
      .filter(dl => {
        if ((dl.getAttribute('aria-label') || '').trim()) return false;
        const ids = (dl.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
        return !ids.some(
          id =>
            d.getElementById(id) &&
            dl.contains(d.getElementById(id)) &&
            (d.getElementById(id).textContent.trim() || d.getElementById(id).id),
        );
      })
      .map(dl => dl.id);
    assert.deepEqual(ohne, []);
  } finally {
    w.close();
  }
});

test('messages are announced', async () => {
  const { w, d } = await openUi();
  try {
    const container = d.getElementById('toasts');
    assert.equal(container.getAttribute('aria-live'), 'polite');
    // An import without a file reports an error.
    d.getElementById('csv-file').dispatchEvent(new w.Event('change', { bubbles: true }));
    await warte(() => container.querySelector('.toast.error'));
    assert.equal(container.querySelector('.toast.error').getAttribute('role'), 'alert');
  } finally {
    w.close();
  }
});
