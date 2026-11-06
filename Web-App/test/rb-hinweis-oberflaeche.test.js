/**
 * Fehlt der Rebrickable-Schlüssel, öffnet der Verwalter trotzdem seine
 * Sammlung. Ein Band weist darauf hin, führt auf Wunsch zum Feld und lässt
 * sich für 30 Tage wegklicken. Am echten Bündel in jsdom.
 *
 * Gegenproben (02.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  in checkRbKey wieder der Sprung auf den Reiter „settings“ → rot:
 *      „Sammlung statt Einstellungen“
 *   B  rbHinweisZeigen() nicht aufgerufen → rot: „Band erscheint“
 *   C  localStorage-Prüfung in rbHinweisZeigen entfernt → rot: „weggeklickt
 *      bleibt es weg“ (03.11.2026: Frist auf 30 Tage gesetzt → rot: „nach
 *      30 Tagen kommt es wieder“)
 *   D  rbHinweisOeffnen ohne Klick auf den Abschnitt → rot: „Link führt zum Feld“
 *   E  einrichtungSpaeter ohne rbHinweisZeigen() → rot: „nach „Später“ im
 *      Assistenten erscheint das Band“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte, takt } = require('./helpers/oberflaeche');

const OHNE_SCHLUESSEL = {
  '/v1/settings/raw': { success: true, settings: { currency: 'EUR', language: 'de', rebrickable_api_key: '' } },
  '/v1/sets': { success: true, total: 1, themes: [],
    sets: [{ set_number: '10294-1', name: 'Titanic', year: 2021, theme: 'Icons', num_parts: 9090, quantity: 1 }] },
};

test('ohne Rebrickable-Schlüssel: Sammlung mit Hinweisband', async (t) => {
  const { w, d, aufrufe } = await oeffneOberflaeche(OHNE_SCHLUESSEL);
  try {
    const band = d.getElementById('rb-hinweis');
    await warte(() => !band.hidden, 2000);
    await t.test('Band erscheint', () => {
      assert.equal(band.hidden, false);
      assert.match(band.textContent, /Rebrickable/);
    });
    await t.test('Sammlung statt Einstellungen', async () => {
      await takt(50);
      assert.equal(d.getElementById('tab-gallery').classList.contains('active'), true);
      assert.equal(d.getElementById('tab-settings').classList.contains('active'), false);
      assert.ok(aufrufe.some(a => /\/v1\/sets(\?|$)/.test(a.url)), 'Sammlung nicht geladen');
    });
    await t.test('Link führt zum Feld', async () => {
      band.querySelector('[data-click="rbHinweisOeffnen"]').click();
      await takt(50);
      assert.equal(d.getElementById('tab-settings').classList.contains('active'), true);
      assert.equal(d.getElementById('einst-rb').classList.contains('einst-aktiv'), true);
      assert.equal(d.activeElement.id, 'rb-key');
      assert.equal(band.hidden, true);
    });
  } finally { w.close(); }
});

test('weggeklickt bleibt es weg — auch in einer neuen Sitzung', async () => {
  const erst = await oeffneOberflaeche(OHNE_SCHLUESSEL);
  let gemerkt;
  try {
    const band = erst.d.getElementById('rb-hinweis');
    await warte(() => !band.hidden, 2000);
    band.querySelector('[data-click="rbHinweisWeg"]').click();
    assert.equal(band.hidden, true);
    gemerkt = erst.w.localStorage.getItem('bim_rb_hinweis_weg');
    assert.ok(gemerkt, 'nichts in localStorage gemerkt');
  } finally { erst.w.close(); }
  const zweit = await oeffneOberflaeche(OHNE_SCHLUESSEL, { vorher: (w) => w.localStorage.setItem('bim_rb_hinweis_weg', gemerkt) });
  try {
    assert.ok(await zweit.ruhig());
    assert.equal(zweit.d.getElementById('rb-hinweis').hidden, true);
  } finally { zweit.w.close(); }
});

test('nach 30 Tagen kommt es wieder', async () => {
  const vor31 = String(Date.now() - 31 * 24 * 3600 * 1000);
  const { w, d } = await oeffneOberflaeche(OHNE_SCHLUESSEL, { vorher: (f) => f.localStorage.setItem('bim_rb_hinweis_weg', vor31) });
  try {
    await warte(() => !d.getElementById('rb-hinweis').hidden, 2000);
    assert.equal(d.getElementById('rb-hinweis').hidden, false);
  } finally { w.close(); }
});

test('nach „Später“ im Assistenten erscheint das Band', async () => {
  const { w, d, ruhig } = await oeffneOberflaeche({ ...OHNE_SCHLUESSEL,
    '/v1/settings/einrichtung': { success: true, offen: true, passwort_aendern: false, quellen: { rebrickable: false } } });
  try {
    await warte(() => d.getElementById('einrichtung-modal').classList.contains('open'));
    assert.ok(await ruhig());
    assert.equal(d.getElementById('rb-hinweis').hidden, true, 'Band über dem Assistenten');
    d.querySelector('#einrichtung-modal [data-click="einrichtungSpaeter"]').click();
    await takt(20);
    assert.equal(d.getElementById('rb-hinweis').hidden, false);
  } finally { w.close(); }
});

test('mit Schlüssel kein Band', async () => {
  const { w, d, ruhig } = await oeffneOberflaeche();
  try {
    assert.ok(await ruhig());
    assert.equal(d.getElementById('rb-hinweis').hidden, true);
  } finally { w.close(); }
});
