/**
 * Ein Fehler der API erscheint als Meldung, nicht als leerer Zustand.
 *
 * Gegenproben (14.11.2026 gemessen):
 *   A  in loadAcqModal() die Prüfung auf `success` entfernt (wie vorher: Liste `|| []`)
 *      → rot: „Kaufpreis-Dialog“ (keine Fehlermeldung, „—“ im Dialog)
 *   B  in katalogAufMerkliste() wieder `if (!d?.success) return;` → rot: „Merken aus dem Katalog“
 *   C  dort das Ergebnis des Alarms wieder verworfen → rot: „… auch der Alarm“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte } = require('./helpers/oberflaeche');

const SN = '10326-1';
const FEHLER = { $status: 500, success: false, code: 'interner_fehler', error: 'Datenbank gestört' };
const meldungen = d => [...d.querySelectorAll('#toasts .toast')].map(t => t.textContent);

test('Kaufpreis-Dialog: ein Lesefehler ist eine Meldung, keine leere Liste', async () => {
  const o = await oeffneOberflaeche({
    [`/v1/sets/${SN}`]: {
      success: true,
      set: { set_number: SN, name: 'Museum', quantity: 5, conditions: ['N'], instructions: [] },
    },
    [`/v1/sets/${SN}/acquisitions`]: FEHLER,
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

async function merkeAusKatalog(antworten, schwelle) {
  const o = await oeffneOberflaeche(antworten);
  const modal = o.d.getElementById('cat-modal');
  modal.dataset.setNumber = SN;
  if (schwelle) o.d.getElementById('cat-m-alert-val').value = schwelle;
  o.d.getElementById('cat-m-wish').click();
  return o;
}

test('Merken aus dem Katalog: ein abgelehntes Merken wird gemeldet', async () => {
  const o = await merkeAusKatalog({ '/v1/wanted': FEHLER });
  try {
    assert.ok(await warte(() => meldungen(o.d).some(m => /Datenbank gestört/.test(m)), 2000), 'keine Meldung');
  } finally {
    o.w.close();
  }
});

test('Merken aus dem Katalog: … auch der Alarm', async () => {
  const o = await merkeAusKatalog(
    {
      '/v1/wanted': { success: true, war_neu: false },
      [`/v1/sets/${encodeURIComponent(SN)}/alert`]: { ...FEHLER, error: 'Alarm abgelehnt' },
      [`/v1/sets/${encodeURIComponent(SN)}`]: { success: true, set: null },
    },
    '12',
  );
  try {
    assert.ok(await warte(() => meldungen(o.d).some(m => /Alarm abgelehnt/.test(m)), 2000), 'keine Meldung');
  } finally {
    o.w.close();
  }
});
