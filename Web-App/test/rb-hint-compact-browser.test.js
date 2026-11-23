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
  const app = await startApp(t, { name: `rbband_${process.pid}`, phone: true });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, until, settle } = app;
  await settle();
  await until(`document.getElementById('rb-hint') && !document.getElementById('rb-hint').hidden`, 'Band');

  await t.test('banner is slim', async () => {
    for (const width of [390, 320]) {
      await b.tab('Emulation.setDeviceMetricsOverride', {
        width: width,
        height: 844,
        deviceScaleFactor: 2,
        mobile: true,
      });
      await settle();
      const h = await b.evaluate(`Math.round(document.getElementById('rb-hint').getBoundingClientRect().height)`);
      assert.ok(h <= 56, `band at ${width} px is ${h} px high`);
      const overflow = await b.evaluate(`document.documentElement.scrollWidth > innerWidth`);
      assert.equal(overflow, false, `band pushes the page wider at ${width} px`);
    }
  });

  await t.test('button keeps its name', async () => {
    const m = await b.evaluate(`(() => { const k = document.querySelector('#rb-hint [data-click="openRbHint"]');
      return { name: k.getAttribute('aria-label'), visible: [...k.querySelectorAll('span')].filter(s => s.checkVisibility()).map(s => s.textContent.trim()) }; })()`);
    assert.equal(m.name, 'Schlüssel eintragen');
    assert.deepEqual(m.visible, ['Eintragen']);
  });
});
