/**
 * The main button of a confirmation dialog names what happens and is only
 * red for final removal (.bd). Real bundle in jsdom: per caller
 * the dialog is opened and button text and class are read.
 *
 * Counter-checks (measured 04.11.2026, each alone, bundle rebuilt):
 *   A  openDialog() again with `!button` as the danger rule (red as soon as no
 *      button is passed) and confirmDeleteWithPassword() without passing on →
 *      both tests red: “create account” with button “Löschen”, English “Delete”
 *   B  in unlinkHousehold() the button spec removed → red: “household”
 *      (button “Löschen” instead of “Verknüpfung lösen”)
 *   C  zwischenspeicherLeeren() with the old text (only the title) → red:
 *      “cache: what gets lost”
 *   D  “Alles löschen” with art 'bp' → red: “delete everything stays red”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte, takt, sicht } = require('./helpers/ui');

/** Reads the open dialog, cancels it and waits until it is closed. */
async function liesDialog(d) {
  const modal = d.getElementById('confirm-modal');
  assert.ok(await warte(() => modal.style.display === 'flex'), 'der Bestätigungsdialog erscheint');
  const knopf = d.getElementById('cd-confirm');
  const stand = {
    text: knopf.textContent.trim(),
    rot: knopf.classList.contains('bd'),
    haupt: knopf.classList.contains('bp'),
    titel: d.getElementById('cd-title').textContent.trim(),
    meldung: d.getElementById('cd-msg').textContent.trim(),
  };
  d.getElementById('cd-cancel').click();
  await warte(() => modal.style.display === 'none');
  await takt(10);
  return stand;
}

test('confirmation dialogs: button text and color per caller', async () => {
  const { w, d } = await openUi({
    '/v1/vouchers': {
      success: true,
      vouchers: [{ id: 3, number: '…9012', pin: '•••', amount: 50, currency: 'CHF', hat_pdf: false }],
    },
    '/v1/settings/household': {
      success: true,
      currency: 'EUR',
      sub_accounts: [{ id: 7, username: 'ben' }],
      parents: [],
    },
    '/v1/admin/cache-stats': { success: true, prices: 4, subsets: 2, catalog: 7 },
  });
  try {
    d.getElementById('nu-n').value = 'carla';
    d.getElementById('nu-p').value = 'Ein-langes-Passwort-42';
    d.getElementById('btn-cu').click();
    const konto = await liesDialog(d);
    assert.deepEqual([konto.text, konto.rot, konto.haupt], ['Konto anlegen', false, true], 'Konto anlegen');

    await sicht(w, 'vouchers');
    assert.ok(await warte(() => d.querySelector('[data-click="toggleVoucherPin"]')), 'Gutscheinliste');
    d.querySelector('[data-click="toggleVoucherPin"]').click();
    const pin = await liesDialog(d);
    assert.deepEqual([pin.text, pin.rot, pin.haupt], ['Anzeigen', false, true], 'Gutschein-PIN');

    await sicht(w, 'household');
    assert.ok(await warte(() => d.querySelector('[data-click="unlinkHousehold"]')), 'Haushaltsliste');
    d.querySelector('[data-click="unlinkHousehold"]').click();
    const haushalt = await liesDialog(d);
    assert.deepEqual([haushalt.text, haushalt.rot], ['Verknüpfung lösen', false], 'Haushalt');

    d.getElementById('btn-clr-all-cache').click();
    const speicher = await liesDialog(d);
    assert.deepEqual([speicher.text, speicher.rot], ['Leeren', true], 'Zwischenspeicher: Knopf');
    assert.match(
      speicher.meldung,
      /4 gespeicherte Preise, 2 Baulisten und 7 Katalog-Einträge/,
      'Zwischenspeicher: was verloren geht',
    );
    assert.match(speicher.meldung, /kontingent/i, 'Zwischenspeicher: was der Neuabruf kostet');

    d.getElementById('btn-dall').click();
    const alles = await liesDialog(d);
    assert.deepEqual([alles.text, alles.rot], ['Alles löschen', true], 'Alles löschen bleibt rot');
  } finally {
    w.close();
  }
});

test('confirmation dialogs in English: the same verb translated', async () => {
  const { w, d } = await openUi(
    {
      '/v1/vouchers': {
        success: true,
        vouchers: [{ id: 3, number: '…9012', pin: '•••', amount: 50, currency: 'CHF', hat_pdf: false }],
      },
    },
    { sprache: 'en' },
  );
  try {
    d.getElementById('nu-n').value = 'carla';
    d.getElementById('nu-p').value = 'Ein-langes-Passwort-42';
    d.getElementById('btn-cu').click();
    const k = await liesDialog(d);
    assert.deepEqual([k.text, k.rot], ['Create account', false]);
    await sicht(w, 'vouchers');
    assert.ok(await warte(() => d.querySelector('[data-click="toggleVoucherPin"]')), 'Gutscheinliste');
    d.querySelector('[data-click="toggleVoucherPin"]').click();
    assert.equal((await liesDialog(d)).text, 'Show');
  } finally {
    w.close();
  }
});
