/**
 * Deleting a voucher in the web app (real bundle in jsdom): the dialog asks as a question for the
 * password, the toast offers „Rückgängig“ — also for a card with a PDF, which the old undo
 * (creating it anew) could not bring back — and „Rückgängig“ calls the restore route.
 *
 * Counter-checks (measured 23.11.2026, each on its own, bundle rebuilt):
 *   A  in deleteVoucher() (js/vouchers.js) the `undo` option removed → red: “the toast offers
 *      undo …” (no „Rückgängig“ in the toast)
 *   B  in deleteRestorable() (js/deletion.js) `if (res === null) return null;` removed → red:
 *      “a cancelled code prompt …” (an error toast appears)
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

async function deleteWithPassword(d) {
  await waitFor(() => d.querySelector('[data-click="deleteVoucher"]'));
  d.querySelector('[data-click="deleteVoucher"]').click();
  const modal = d.getElementById('confirm-modal');
  assert.ok(await waitFor(() => modal.style.display === 'flex' && !d.getElementById('cd-pw-wrap').hidden));
  const dialog = { title: text(d.getElementById('cd-title')), button: text(d.getElementById('cd-confirm')) };
  d.getElementById('cd-pw').value = 'Mein-Passwort-1';
  d.getElementById('cd-confirm').click();
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
    const dialog = await deleteWithPassword(d);
    assert.deepEqual(dialog, { title: 'Gutschein löschen?', button: 'Löschen' });
    assert.ok(
      await waitFor(() => toastButtons(d).some(b => /Rückgängig/.test(b.textContent))),
      `no undo in the toast: ${text(d.getElementById('toasts'))}`,
    );
    const del = calls.find(c => c.method === 'DELETE');
    assert.deepEqual(JSON.parse(del.body), { password: 'Mein-Passwort-1' });

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

test('a cancelled code prompt deletes nothing and reports nothing', async () => {
  const { w, d, calls } = await openUi({
    '/v2/vouchers': LIST,
    '/v2/vouchers/3': { $status: 400, success: false, code: 'second_factor_required', error: 'Code fehlt' },
  });
  try {
    await view(w, 'vouchers');
    await deleteWithPassword(d);
    const codeWrap = d.getElementById('cd-code-wrap');
    assert.ok(await waitFor(() => !codeWrap.hidden), 'the code prompt appears');
    d.getElementById('cd-cancel').click();
    await tick(50);
    assert.equal(calls.filter(c => c.method === 'DELETE').length, 1);
    assert.equal(text(d.getElementById('toasts')), '', 'a cancel is no error');
  } finally {
    w.close();
  }
});
