/**
 * Screen reader: every dialog has a name, and messages are announced —
 * errors immediately. On the real bundle in jsdom.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  aria-labelledby removed from set-modal → red: “every dialog has a
 *      name” (set-modal)
 *   B  role="alert" for error messages removed → red: “messages are
 *      announced”
 * Counter-check (22.11.2026): announce() always into #ansage-status → red: “messages are
 *   announced” (error text not in the alert region)
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

test('messages are announced: status politely, errors assertively', async () => {
  const { w, d } = await openUi();
  try {
    const status = d.getElementById('announcement-status');
    const fehler = d.getElementById('announcement-error');
    assert.equal(status.getAttribute('aria-live'), 'polite');
    assert.equal(fehler.getAttribute('role'), 'alert');
    // The toast list itself is no live region any more: nested in it, an alert was announced twice.
    assert.equal(d.getElementById('toasts').closest('[aria-live], [role="status"], [role="alert"]'), null);
    // An import without a file reports an error.
    d.getElementById('csv-file').dispatchEvent(new w.Event('change', { bubbles: true }));
    await warte(() => d.getElementById('toasts').querySelector('.toast.error'));
    const text = d.getElementById('toasts').querySelector('.toast.error .toast-text').textContent;
    await warte(() => fehler.textContent === text);
    assert.notEqual(status.textContent, text, 'error also read in the polite region');
  } finally {
    w.close();
  }
});
