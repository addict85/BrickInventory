/**
 * Der Hauptknopf eines Bestätigungsdialogs nennt, was geschieht, und ist nur
 * bei endgültigem Entfernen rot (.bd). Echtes Bündel in jsdom: Je Aufrufer
 * wird der Dialog geöffnet und Knopftext und -klasse gelesen.
 *
 * Gegenproben (04.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  dialogOeffnen() wieder mit `!knopf` als Gefahrenregel (rot, sobald kein
 *      Knopf übergeben wird) und bestaetigeMitPasswort() ohne Weitergabe →
 *      beide Tests rot: „Konto anlegen“ mit Knopf „Löschen“, englisch „Delete“
 *   B  in unlinkHousehold() die Knopfangabe entfernt → rot: „Haushalt“
 *      (Knopf „Löschen“ statt „Verknüpfung lösen“)
 *   C  zwischenspeicherLeeren() mit dem alten Text (nur der Titel) → rot:
 *      „Zwischenspeicher: was verloren geht“
 *   D  „Alles löschen“ mit art 'bp' → rot: „Alles löschen bleibt rot“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte, takt, sicht } = require('./helpers/oberflaeche');

/** Liest den offenen Dialog, bricht ihn ab und wartet, bis er zu ist. */
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

test('Bestätigungsdialoge: Knopftext und Farbe je Aufrufer', async () => {
  const { w, d } = await oeffneOberflaeche({
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

    await sicht(w, 'gutscheine');
    assert.ok(await warte(() => d.querySelector('[data-click="gutscheinPinUmschalten"]')), 'Gutscheinliste');
    d.querySelector('[data-click="gutscheinPinUmschalten"]').click();
    const pin = await liesDialog(d);
    assert.deepEqual([pin.text, pin.rot, pin.haupt], ['Anzeigen', false, true], 'Gutschein-PIN');

    await sicht(w, 'haushalt');
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

test('Bestätigungsdialoge auf Englisch: dasselbe Verb übersetzt', async () => {
  const { w, d } = await oeffneOberflaeche(
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
    await sicht(w, 'gutscheine');
    assert.ok(await warte(() => d.querySelector('[data-click="gutscheinPinUmschalten"]')), 'Gutscheinliste');
    d.querySelector('[data-click="gutscheinPinUmschalten"]').click();
    assert.equal((await liesDialog(d)).text, 'Show');
  } finally {
    w.close();
  }
});
