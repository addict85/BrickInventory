/**
 * An API error appears as a message, not as an empty state.
 *
 * Counter-checks (measured 14.11.2026):
 *   A  in loadAcqModal() the check for `success` removed (as before: list `|| []`)
 *      → red: “purchase price dialog” (no error message, “—” in the dialog)
 *   B  in catalogToWanted() again `if (!d?.success) return;` → red: “remember from the catalog”
 *   C  there the result of the alert discarded again → red: “… the alert too”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte } = require('./helpers/ui');

const SN = '10326-1';
const FEHLER = { $status: 500, success: false, code: 'internal_error', error: 'Datenbank gestört' };
const meldungen = d => [...d.querySelectorAll('#toasts .toast')].map(t => t.textContent);

test('purchase price dialog: a read error is a message, not an empty list', async () => {
  const o = await openUi({
    [`/v2/sets/${SN}`]: {
      success: true,
      set: { set_number: SN, name: 'Museum', quantity: 5, conditions: ['N'], instructions: [] },
    },
    [`/v2/sets/${SN}/acquisitions`]: FEHLER,
  });
  try {
    const knopf = o.d.createElement('button');
    knopf.dataset.click = 'openModal';
    knopf.dataset.arg = SN;
    o.d.body.append(knopf);
    knopf.click();
    await warte(() => o.d.querySelector('#set-modal [data-click="openAcqModal"]'), 4000);
    o.d.querySelector('#set-modal [data-click="openAcqModal"]').click();
    assert.ok(await warte(() => meldungen(o.d).some(m => /Datenbank gestört/.test(m)), 2000), 'keine Meldung');
    assert.doesNotMatch(o.d.getElementById('acq-modal-body')?.textContent ?? '', /^—$/);
  } finally {
    o.w.close();
  }
});

async function rememberFromCatalog(antworten, schwelle) {
  const o = await openUi(antworten);
  const modal = o.d.getElementById('cat-modal');
  modal.dataset.setNumber = SN;
  if (schwelle) o.d.getElementById('cat-m-alert-val').value = schwelle;
  o.d.getElementById('cat-m-wish').click();
  return o;
}

test('remember from the catalog: a rejected remember is reported', async () => {
  const o = await rememberFromCatalog({ '/v2/wanted': FEHLER });
  try {
    assert.ok(await warte(() => meldungen(o.d).some(m => /Datenbank gestört/.test(m)), 2000), 'keine Meldung');
  } finally {
    o.w.close();
  }
});

test('remember from the catalog: … the alert too', async () => {
  const o = await rememberFromCatalog(
    {
      '/v2/wanted': { success: true, was_new: false },
      [`/v2/sets/${encodeURIComponent(SN)}/alert`]: { ...FEHLER, error: 'Alarm abgelehnt' },
      [`/v2/sets/${encodeURIComponent(SN)}`]: { success: true, set: null },
    },
    '12',
  );
  try {
    assert.ok(await warte(() => meldungen(o.d).some(m => /Alarm abgelehnt/.test(m)), 2000), 'keine Meldung');
  } finally {
    o.w.close();
  }
});
