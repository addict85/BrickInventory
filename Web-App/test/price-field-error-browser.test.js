/**
 * Error message at the price field with currency choice (dialog „Set hinzufügen“), measured in Chrome at 390 and
 * 1280 px: the price field keeps its width, the message stands below the whole row.
 *
 * Counter-check (measured 08.11.2026): in fieldError (formular.js) the message put directly behind the
 * input field again instead of behind the wrapper `.price-with-currency`
 *   → red in both widths: price field only ~25 px wide, message next to the currency.
 *
 * Without Chrome (CHROME_BIN, google-chrome, chromium) it is skipped.
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');

const MEASURE = `(() => { const r = id => document.getElementById(id).getBoundingClientRect();
  const m = document.getElementById('add-price-error'), zeile = document.querySelector('#add-set-modal .price-with-currency').getBoundingClientRect();
  const p = r('add-price'), w = r('add-currency'), f = m.getBoundingClientRect();
  return { sichtbar: !m.hidden && f.height > 0, text: m.textContent, priceWidth: Math.round(p.width), rowWidth: Math.round(zeile.width),
           bottomUnderneath: f.top >= Math.max(p.bottom, w.bottom) - 1, messageWidth: Math.round(f.width),
           nebeneinander: Math.abs(p.top - w.top) < 2 }; })()`;

test('price field: error message below the whole row', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await startApp(t, { name: `preisfehler_${process.pid}`, telefon: true });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, bis, ruhig } = app;
  await ruhig();
  await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
  await bis(`document.getElementById('tab-gallery').classList.contains('active')`, 'Galerie');
  await ruhig();

  for (const [breite, mobil] of [
    [390, true],
    [1280, false],
  ]) {
    await t.test(`${breite} px: message below the row, price field keeps its width`, async () => {
      await b.tab('Emulation.setDeviceMetricsOverride', {
        width: breite,
        height: 900,
        deviceScaleFactor: 1,
        mobile: mobil,
      });
      await bis(`innerWidth === ${breite}`, 'Fenstergrösse');
      await b.auswerten(`document.querySelector('button[data-click="openCapture"][data-arg="set"]').click(); true`);
      await bis(`document.getElementById('add-set-modal').classList.contains('open')`, 'Dialog offen');
      await b.auswerten(`(() => { document.getElementById('add-num').value = '75192-1';
        document.getElementById('add-price').value = '12,x'; document.getElementById('btn-add').click(); return true; })()`);
      await bis(`!document.getElementById('add-price-error')?.hidden`, 'Meldung am Preisfeld');
      const m = await b.auswerten(MEASURE);
      await b.auswerten(`document.querySelector('#add-set-modal [data-click="closeCapture"]').click(); true`);
      assert.equal(m.sichtbar, true, 'Meldung nicht sichtbar');
      assert.match(m.text, /12,x/);
      assert.equal(m.nebeneinander, true, 'Währung steht nicht mehr neben dem Preis');
      assert.ok(m.priceWidth >= 80, `Preisfeld nur ${m.priceWidth} px breit`);
      assert.equal(m.bottomUnderneath, true, 'Meldung steht nicht unter Preis und Währung');
      assert.ok(m.messageWidth >= m.rowWidth - 2, `Meldung ${m.messageWidth} px, Zeile ${m.rowWidth} px`);
    });
  }
});
