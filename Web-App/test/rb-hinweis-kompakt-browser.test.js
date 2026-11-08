/**
 * Das Band „Rebrickable-Schlüssel fehlt“ ist am Telefon schlank: höchstens 56 px hoch (zwei Zeilen Text
 * neben Knopf und Schliessen) und nicht mehr drei Zeilen mit 68 px. Der Knopf „Eintragen“ behält seinen
 * vollen Namen „Schlüssel eintragen“ für Vorleser. Gemessen im Browser bei 390 und 320 px.
 *
 * Gegenproben (08.11.2026 gemessen, je einzeln):
 *   A  de.js 'rb_key.banner_short' wieder „Ohne Rebrickable-Schlüssel keine neuen Sets.“ → rot:
 *      „Band ist schlank“ (68 px bei 320 px)
 *   B  aria-label am Knopf in index.html entfernt → rot: „Knopf behält seinen Namen“ („Eintragen“)
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp } = require('./helpers/app-browser');

test('Schlüssel-Band am Telefon', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await starteApp(t, { name: `rbband_${process.pid}`, telefon: true });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }
  const { b, bis, ruhig } = app;
  await ruhig();
  await bis(`document.getElementById('rb-hinweis') && !document.getElementById('rb-hinweis').hidden`, 'Band');

  await t.test('Band ist schlank', async () => {
    for (const breite of [390, 320]) {
      await b.tab('Emulation.setDeviceMetricsOverride', {
        width: breite,
        height: 844,
        deviceScaleFactor: 2,
        mobile: true,
      });
      await ruhig();
      const h = await b.auswerten(`Math.round(document.getElementById('rb-hinweis').getBoundingClientRect().height)`);
      assert.ok(h <= 56, `Band bei ${breite} px ${h} px hoch`);
      const ueberlauf = await b.auswerten(`document.documentElement.scrollWidth > innerWidth`);
      assert.equal(ueberlauf, false, `Band schiebt die Seite bei ${breite} px auf`);
    }
  });

  await t.test('Knopf behält seinen Namen', async () => {
    const m =
      await b.auswerten(`(() => { const k = document.querySelector('#rb-hinweis [data-click="rbHinweisOeffnen"]');
      return { name: k.getAttribute('aria-label'), sichtbar: [...k.querySelectorAll('span')].filter(s => s.checkVisibility()).map(s => s.textContent.trim()) }; })()`);
    assert.equal(m.name, 'Schlüssel eintragen');
    assert.deepEqual(m.sichtbar, ['Eintragen']);
  });
});
