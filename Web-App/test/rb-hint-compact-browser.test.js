/**
 * The banner „Rebrickable-Schlüssel fehlt“ is slim on the phone: at most 56 px high (two lines of text
 * next to button and close) and no longer three lines with 68 px. The button „Eintragen“ keeps its
 * full name „Schlüssel eintragen“ for screen readers. Measured in the browser at 390 and 320 px.
 *
 * Counter-checks (measured 08.11.2026, each on its own):
 *   A  de.js 'rb_key.banner_short' again „Ohne Rebrickable-Schlüssel keine neuen Sets.“ → red:
 *      “banner is slim” (68 px at 320 px)
 *   B  aria-label on the button removed in index.html → red: “button keeps its name” („Eintragen“)
 *
 * Without Chrome (CHROME_BIN, google-chrome, chromium) it is skipped.
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');

test('key banner on the phone', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await startApp(t, { name: `rbband_${process.pid}`, telefon: true });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, bis, ruhig } = app;
  await ruhig();
  await bis(`document.getElementById('rb-hint') && !document.getElementById('rb-hint').hidden`, 'Band');

  await t.test('banner is slim', async () => {
    for (const breite of [390, 320]) {
      await b.tab('Emulation.setDeviceMetricsOverride', {
        width: breite,
        height: 844,
        deviceScaleFactor: 2,
        mobile: true,
      });
      await ruhig();
      const h = await b.auswerten(`Math.round(document.getElementById('rb-hint').getBoundingClientRect().height)`);
      assert.ok(h <= 56, `band at ${breite} px is ${h} px high`);
      const overflow = await b.auswerten(`document.documentElement.scrollWidth > innerWidth`);
      assert.equal(overflow, false, `band pushes the page wider at ${breite} px`);
    }
  });

  await t.test('button keeps its name', async () => {
    const m = await b.auswerten(`(() => { const k = document.querySelector('#rb-hint [data-click="openRbHint"]');
      return { name: k.getAttribute('aria-label'), sichtbar: [...k.querySelectorAll('span')].filter(s => s.checkVisibility()).map(s => s.textContent.trim()) }; })()`);
    assert.equal(m.name, 'Schlüssel eintragen');
    assert.deepEqual(m.sichtbar, ['Eintragen']);
  });
});
