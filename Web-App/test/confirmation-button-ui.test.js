/**
 * The main button of a confirmation dialog names what happens and is only
 * red for final removal (.bd); no dialog has a password field. Real bundle in
 * jsdom: per caller the dialog is opened and button text and class are read.
 *
 * Counter-checks (measured 04.11.2026, each alone, bundle rebuilt):
 *   A  (26.11.2026) confirmTexts() with `!button?.kind` as the danger rule →
 *      both tests red: “delete everything stays red”
 *   B  in unlinkHousehold() the button spec removed → red: “household”
 *      (button “Löschen” instead of “Verknüpfung lösen”)
 *   C  zwischenspeicherLeeren() with the old text (only the title) → red:
 *      “cache: what gets lost”
 *   D  “Alles löschen” with art 'bp' → red: “delete everything stays red”
 *   E  (26.11.2026) a password input back into #confirm-modal (index.html) →
 *      red: “no password field”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, waitFor, tick, view } = require('./helpers/ui');

/** Reads the open dialog, cancels it and waits until it is closed. */
async function readDialog(d) {
  const modal = d.getElementById('confirm-modal');
  assert.ok(await waitFor(() => modal.style.display === 'flex'), 'the confirmation dialog appears');
  const button = d.getElementById('cd-confirm');
  assert.equal(modal.querySelector('input[type="password"]'), null, 'no password field');
  const state = {
    text: button.textContent.trim(),
    rot: button.classList.contains('bd'),
    main: button.classList.contains('bp'),
    title: d.getElementById('cd-title').textContent.trim(),
    message: d.getElementById('cd-msg').textContent.trim(),
  };
  d.getElementById('cd-cancel').click();
  await waitFor(() => modal.style.display === 'none');
  await tick(10);
  return state;
}

test('confirmation dialogs: button text and color per caller', async () => {
  const { w, d } = await openUi({
    '/v2/vouchers': {
      success: true,
      vouchers: [{ id: 3, number: '…9012', pin: '•••', amount: 50, currency: 'CHF', has_pdf: false }],
    },
    '/v2/settings/household': {
      success: true,
      currency: 'EUR',
      sub_accounts: [{ id: 7, username: 'ben' }],
      parents: [],
    },
    '/v2/admin/cache-stats': { success: true, prices: 4, subsets: 2, catalog: 7 },
  });
  try {
    await view(w, 'household');
    assert.ok(await waitFor(() => d.querySelector('[data-click="unlinkHousehold"]')), 'Haushaltsliste');
    d.querySelector('[data-click="unlinkHousehold"]').click();
    const household = await readDialog(d);
    assert.deepEqual([household.text, household.rot, household.main], ['Verknüpfung lösen', false, true], 'Household');

    d.getElementById('btn-clr-all-cache').click();
    const storage = await readDialog(d);
    assert.deepEqual([storage.text, storage.rot], ['Leeren', true], 'Cache: button');
    assert.match(storage.message, /4 gespeicherte Preise, 2 Baulisten und 7 Katalog-Einträge/, 'cache: what gets lost');
    assert.match(storage.message, /kontingent/i, 'Cache: what refetching costs');

    d.getElementById('btn-dall').click();
    const alles = await readDialog(d);
    assert.deepEqual([alles.text, alles.rot], ['Alles löschen', true], 'Delete everything stays red');
  } finally {
    w.close();
  }
});

test('confirmation dialogs in English: the same verb translated', async () => {
  const { w, d } = await openUi({}, { language: 'en' });
  try {
    d.getElementById('btn-dall').click();
    const k = await readDialog(d);
    assert.deepEqual([k.text, k.rot], ['Delete everything', true], 'delete everything stays red');
  } finally {
    w.close();
  }
});
