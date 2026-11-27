/**
 * "Leere Gutscheine entfernen" in the web app (real bundle in jsdom): the box shows the
 * account's stored switch and saves a click at once; after the balance run the cards the
 * server removed at 0.00 are reported in one toast with undo, and the list is reloaded.
 *
 * Counter-checks (measured 27.11.2026, each alone, bundle rebuilt):
 *   A  in loadVouchers() (js/vouchers.js) the line setting `removeEmpty.checked` removed → red:
 *      “the box shows the stored switch …” (box unchecked)
 *   B  in saveRemoveEmpty() `box.checked = want` after success removed → red: “the box shows …”
 *      (box flips back)
 *   C  in queryAllBalances() (js/balance.js) `reportRemoved(removed)` at the end removed → red:
 *      “the run reports removed cards …” (no toast)
 *   D  'vouchers.removed_empty' in en.js deleted → red: i18n.test.js (key sets); here green, tRaw
 *      falls back to German — that test catches the gap.
 *   E  'saveRemoveEmpty' missing in ONLY.change (js/actions.js) → red: “the box shows …” (not saved)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, waitFor, view } = require('./helpers/ui');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const voucher = (id, amount) => ({
  id,
  number: `…90${id}`,
  pin: '•••',
  amount,
  currency: 'CHF',
  has_pdf: false,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-01T10:00:00Z',
  balance_checked_at: null,
});
const LIST = { success: true, vouchers: [voucher(1, 20), voucher(2, 30), voucher(3, 40)] };
const RAW = on => ({ success: true, settings: { currency: 'CHF', language: 'de', remove_empty_vouchers: on } });
const balance = (id, amount, removed) => ({
  success: true,
  voucher: { ...voucher(id, amount), balance_checked_at: '2026-11-27T02:00:00Z' },
  displayed: `CHF ${amount.toFixed(2)}`,
  currency_changed: false,
  removed,
});

test('the box shows the stored switch and saves a click at once', async () => {
  const { w, d, calls } = await openUi({
    '/v2/vouchers': LIST,
    '/v2/settings/raw': RAW('1'),
    '/v2/settings': { success: true },
  });
  try {
    await view(w, 'vouchers');
    const box = d.getElementById('vouchers-remove-empty');
    assert.ok(await waitFor(() => box.checked), 'stored switch not shown');
    assert.match(text(box.closest('label')), /Leere Gutscheine entfernen/);
    box.checked = false;
    box.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(
      await waitFor(() => calls.some(c => c.method === 'POST' && c.url.endsWith('/api/v2/settings'))),
      'not saved',
    );
    const post = calls.find(c => c.method === 'POST' && c.url.endsWith('/api/v2/settings'));
    assert.deepEqual(JSON.parse(post.body), { remove_empty_vouchers: '0' });
    assert.ok(await waitFor(() => /gespeichert/i.test(text(d.getElementById('toasts')))));
    assert.equal(box.checked, false);
  } finally {
    w.close();
  }
});

test('the run reports removed cards in one toast with undo and reloads the list', async () => {
  const { w, d, calls } = await openUi({
    '/v2/vouchers': LIST,
    '/v2/settings/raw': RAW('1'),
    '/v2/vouchers/1/balance': balance(1, 0, true),
    '/v2/vouchers/2/balance': balance(2, 5, false),
    '/v2/vouchers/3/balance': balance(3, 0, true),
    '/v2/vouchers/1/restore': { success: true, voucher: voucher(1, 0) },
    '/v2/vouchers/3/restore': { success: true, voucher: voucher(3, 0) },
  });
  try {
    await view(w, 'vouchers');
    await waitFor(() => d.querySelectorAll('.voucher-row').length === 3);
    const lists = () => calls.filter(c => c.method === 'GET' && c.url.endsWith('/api/v2/vouchers')).length;
    const before = lists();
    d.querySelector('[data-click="queryAllBalances"]').click();
    assert.ok(
      await waitFor(() => /2 leere Gutscheine entfernt/.test(text(d.getElementById('toasts'))), 5000),
      `no removal toast: ${text(d.getElementById('toasts'))}`,
    );
    assert.ok(await waitFor(() => lists() > before), 'list not reloaded');
    const undo = [...d.querySelectorAll('#toasts button')].find(b => /Rückgängig/.test(b.textContent));
    assert.ok(undo, 'no undo');
    undo.click();
    assert.ok(
      await waitFor(
        () =>
          ['/1/restore', '/3/restore'].every(p => calls.some(c => c.method === 'POST' && c.url.endsWith(p))) &&
          !calls.some(c => c.url.endsWith('/2/restore')),
      ),
      'undo restores exactly the removed cards',
    );
  } finally {
    w.close();
  }
});
