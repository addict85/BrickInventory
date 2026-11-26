/**
 * Deleting a voucher in the web app (real bundle in jsdom): the dialog asks a question without
 * password, the toast offers „Rückgängig“ — also for a card with a PDF, which the old undo
 * (creating it anew) could not bring back — and „Rückgängig“ calls the restore route.
 *
 * Counter-checks (measured 23.11.2026, each on its own, bundle rebuilt):
 *   A  in deleteVoucher() (js/vouchers.js) the `undo` option removed → red: “the toast offers
 *      undo …” (no „Rückgängig“ in the toast)
 *   B  (26.11.2026) in deleteVoucher() `if (!yes) return;` removed → red: “cancelling the
 *      question …” (the DELETE went out)
 *   C  'vouchers.delete_title' in de.js back to „Gutschein löschen“ → red: “the toast offers
 *      undo …” (title without question mark)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, waitFor, tick, view } = require('./helpers/ui');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const LIST = {
  success: true,
  vouchers: [
    {
      id: 3,
      number: '…9012',
      pin: '•••',
      amount: 50,
      currency: 'CHF',
      has_pdf: true,
      created_at: '2026-11-01T10:00:00Z',
      updated_at: '2026-11-01T10:00:00Z',
      balance_checked_at: null,
    },
  ],
};
const RESTORED = { success: true, voucher: LIST.vouchers[0] };

/** Opens the question; `yes` answers it, otherwise it is cancelled. */
async function deleteAsked(d, yes = true) {
  await waitFor(() => d.querySelector('[data-click="deleteVoucher"]'));
  d.querySelector('[data-click="deleteVoucher"]').click();
  const modal = d.getElementById('confirm-modal');
  assert.ok(await waitFor(() => modal.style.display === 'flex'), 'the question appears');
  assert.equal(modal.querySelector('input[type="password"]'), null, 'the question asks for a password');
  const dialog = { title: text(d.getElementById('cd-title')), button: text(d.getElementById('cd-confirm')) };
  d.getElementById(yes ? 'cd-confirm' : 'cd-cancel').click();
  await tick(20);
  return dialog;
}

const toastButtons = d => [...d.querySelectorAll('#toasts button')];

test('the toast offers undo for a card with PDF, and undo restores it on the server', async () => {
  const { w, d, calls } = await openUi({
    '/v2/vouchers': LIST,
    '/v2/vouchers/3': { success: true },
    '/v2/vouchers/3/restore': RESTORED,
  });
  try {
    await view(w, 'vouchers');
    const dialog = await deleteAsked(d);
    assert.deepEqual(dialog, { title: 'Gutschein löschen?', button: 'Löschen' });
    assert.ok(
      await waitFor(() => toastButtons(d).some(b => /Rückgängig/.test(b.textContent))),
      `no undo in the toast: ${text(d.getElementById('toasts'))}`,
    );
    const del = calls.find(c => c.method === 'DELETE');
    assert.equal(del.body ?? null, null, 'the request carries no password');

    toastButtons(d)
      .find(b => /Rückgängig/.test(b.textContent))
      .click();
    assert.ok(
      await waitFor(() => calls.some(c => c.method === 'POST' && c.url.endsWith('/api/v2/vouchers/3/restore'))),
      'undo did not call the restore route',
    );
    assert.ok(await waitFor(() => /Wiederhergestellt/.test(text(d.getElementById('toasts')))));
    assert.equal(
      calls.some(c => c.method === 'POST' && /\/v2\/vouchers$/.test(c.url)),
      false,
      'undo creates the card anew instead of restoring it',
    );
  } finally {
    w.close();
  }
});

test('cancelling the question deletes nothing and reports nothing', async () => {
  const { w, d, calls } = await openUi({ '/v2/vouchers': LIST, '/v2/vouchers/3': { success: true } });
  try {
    await view(w, 'vouchers');
    await deleteAsked(d, false);
    await tick(50);
    assert.equal(calls.filter(c => c.method === 'DELETE').length, 0);
    assert.equal(text(d.getElementById('toasts')), '', 'a cancel is no error');
  } finally {
    w.close();
  }
});
