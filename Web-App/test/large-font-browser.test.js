/**
 * Double font size (browser setting 32 px) and narrow devices:
 * the collection stays readable. Measured in Chrome with Page.setFontSizes,
 * i.e. the way a user enlarges the font in the browser.
 *
 * Counter-checks (measured 02.11.2026, each alone):
 *   A  .sgrid in mobile.css back to minmax(150px, 1fr) → red: “390 px, 200 %”
 *      (sticks out over the tile: market row, date)
 *   B  white-space:nowrap removed from .snum, together with A (alone nothing
 *      breaks in one column) → red: “390 px, 200 %” (set number on two
 *      lines, in addition to the findings of A)
 *   C  two-row bar ineffective (@media max-width: 1px instead of 19.5em)
 *      → red: “390 px, 200 %” and “320 px, 200 %” (label cut off)
 *   F  (02.11.) old rule back: label visually hidden at large font
 *      → red: “390 px, 200 %” and “320 px, 200 %” (only icon)
 *   D  .bstat-l back to overflow-wrap:anywhere and .brick-stats back to
 *      repeat(2, minmax(0, 1fr)) → red: “390 px, 200 %” and “320 px, 200 %”
 *      (word broken: “Minifiguren”, “Anleitungen”)
 *   E  mobile.css .btn back to font-size:16px → red: “390 px, 200 %” and
 *      “320 px, 200 %” (button font does not grow along)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');
const { patternCollection } = require('./helpers/inventory');

const MEASUREMENT = `(() => {
  const funde = [];
  const name = (e) => e.tagName.toLowerCase() + [...e.classList].slice(0, 2).map(c => '.' + c).join('') + ' „' + (e.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 20) + '“';
  const breite = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > breite + 1) funde.push('Seite ' + document.documentElement.scrollWidth + ' px breit');
  const zeile = (e) => parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.5;
  for (const n of document.querySelectorAll('#gallery .snum'))
    if (n.getBoundingClientRect().height > zeile(n) * 1.5) funde.push('Set-Nummer auf zwei Zeilen: ' + name(n));
  for (const k of document.querySelectorAll('#gallery .sc')) {
    const r = k.getBoundingClientRect();
    for (const e of k.querySelectorAll('.scb *')) {
      const s = e.getBoundingClientRect();
      if (s.width && (s.right > r.right + 1 || s.left < r.left - 1)) { funde.push('ragt über die Kachel: ' + name(e)); break; }
    }
  }
  // Ein Wort, das bricht, macht die Beschriftung höher als die Zahl ihrer Wörter Zeilen.
  for (const l of document.querySelectorAll('#tab-gallery .bstat-l')) {
    const words = l.textContent.trim().split(/\\s+/).length;
    if (l.getBoundingClientRect().height > zeile(l) * words + 1) funde.push('Wort gebrochen: ' + name(l));
  }
  for (const t of document.querySelectorAll('nav .ntab')) {
    if (!t.checkVisibility()) continue;
    const l = t.querySelector('.tab-label');
    const versteckt = l.getBoundingClientRect().width <= 1;
    if (!versteckt && l.scrollWidth > l.clientWidth + 1) funde.push('Leiste: „' + l.textContent.trim() + '“ abgeschnitten');
    if (versteckt) funde.push('Leiste: nur Symbol für „' + l.textContent.trim() + '“');
  }
  const knopf = document.querySelector('#tab-gallery .erfassen-leiste .btn.bp');
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  if (knopf && parseFloat(getComputedStyle(knopf).fontSize) < rem * 0.8) funde.push('Knopfschrift ' + getComputedStyle(knopf).fontSize + ' bei ' + rem + ' px Grundschrift');
  const spalten = getComputedStyle(document.querySelector('#gallery .sgrid')).gridTemplateColumns.split(' ').length;
  return { funde, spalten, rem };
})()`;

test('large font and narrow devices: collection readable', { timeout: 180_000 }, async t => {
  const app = await startApp(t, { name: `gross_${process.pid}`, bestand: patternCollection });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }
  const { b, ruhig } = app;
  // Startup loads settings and prices afterwards; only then is the state fixed.
  await ruhig();
  await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
  await app.bis(`document.querySelectorAll('#gallery .sc').length >= 4`, 'Kacheln');
  const fall = async (breite, schrift) => {
    await b.tab('Emulation.setDeviceMetricsOverride', {
      width: breite,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await b.tab('Page.setFontSizes', { fontSizes: { standard: schrift, fixed: Math.round(schrift * 0.8) } });
    await ruhig();
    return b.auswerten(MEASUREMENT);
  };
  for (const [breite, schrift, spalten] of [
    [390, 16, 2],
    [320, 16, 1],
    [390, 32, 1],
    [320, 32, 1],
  ]) {
    await t.test(`${breite} px, ${schrift === 32 ? '200' : '100'} %`, async () => {
      const m = await fall(breite, schrift);
      assert.equal(m.rem, schrift, 'Grundschrift nicht übernommen');
      assert.deepEqual(m.funde, []);
      assert.equal(m.spalten, spalten, 'Spalten im Raster');
    });
  }
});
