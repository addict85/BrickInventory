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
  const findings = [];
  const name = (e) => e.tagName.toLowerCase() + [...e.classList].slice(0, 2).map(c => '.' + c).join('') + ' „' + (e.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 20) + '“';
  const width = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > width + 1) findings.push('Seite ' + document.documentElement.scrollWidth + ' px breit');
  const line = (e) => parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.5;
  for (const n of document.querySelectorAll('#gallery .snum'))
    if (n.getBoundingClientRect().height > line(n) * 1.5) findings.push('Set-Nummer auf zwei Zeilen: ' + name(n));
  for (const k of document.querySelectorAll('#gallery .sc')) {
    const r = k.getBoundingClientRect();
    for (const e of k.querySelectorAll('.scb *')) {
      const s = e.getBoundingClientRect();
      if (s.width && (s.right > r.right + 1 || s.left < r.left - 1)) { findings.push('ragt über die Kachel: ' + name(e)); break; }
    }
  }
  // Ein Wort, das bricht, macht die Beschriftung höher als die Zahl ihrer Wörter Zeilen.
  for (const l of document.querySelectorAll('#tab-gallery .bstat-l')) {
    const words = l.textContent.trim().split(/\\s+/).length;
    if (l.getBoundingClientRect().height > line(l) * words + 1) findings.push('Wort gebrochen: ' + name(l));
  }
  for (const t of document.querySelectorAll('nav .ntab')) {
    if (!t.checkVisibility()) continue;
    const l = t.querySelector('.tab-label');
    const hidden = l.getBoundingClientRect().width <= 1;
    if (!hidden && l.scrollWidth > l.clientWidth + 1) findings.push('Leiste: „' + l.textContent.trim() + '“ abgeschnitten');
    if (hidden) findings.push('Leiste: nur Symbol für „' + l.textContent.trim() + '“');
  }
  const button = document.querySelector('#tab-gallery .capture-bar .btn.bp');
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  if (button && parseFloat(getComputedStyle(button).fontSize) < rem * 0.8) findings.push('Knopfschrift ' + getComputedStyle(button).fontSize + ' bei ' + rem + ' px Grundschrift');
  const columns = getComputedStyle(document.querySelector('#gallery .sgrid')).gridTemplateColumns.split(' ').length;
  return { findings, columns, rem };
})()`;

test('large font and narrow devices: collection readable', { timeout: 180_000 }, async t => {
  const app = await startApp(t, { name: `gross_${process.pid}`, holding: patternCollection });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, settle } = app;
  // Startup loads settings and prices afterwards; only then is the state fixed.
  await settle();
  await b.evaluate(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
  await app.until(`document.querySelectorAll('#gallery .sc').length >= 4`, 'Kacheln');
  const fall = async (width, font) => {
    await b.tab('Emulation.setDeviceMetricsOverride', {
      width: width,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await b.tab('Page.setFontSizes', { fontSizes: { standard: font, fixed: Math.round(font * 0.8) } });
    await settle();
    return b.evaluate(MEASUREMENT);
  };
  for (const [width, font, columns] of [
    [390, 16, 2],
    [320, 16, 1],
    [390, 32, 1],
    [320, 32, 1],
  ]) {
    await t.test(`${width} px, ${font === 32 ? '200' : '100'} %`, async () => {
      const m = await fall(width, font);
      assert.equal(m.rem, font, 'Base font not taken over');
      assert.deepEqual(m.findings, []);
      assert.equal(m.columns, columns, 'Columns in the grid');
    });
  }
});
