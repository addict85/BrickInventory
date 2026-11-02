/**
 * Doppelte Schriftgrösse (Browser-Einstellung 32 px) und schmale Geräte:
 * Die Sammlung bleibt lesbar. Gemessen in Chrome mit Page.setFontSizes,
 * also so, wie ein Nutzer die Schrift im Browser vergrössert.
 *
 *   - kein waagrechter Überlauf der Seite;
 *   - Set-Nummern stehen auf einer Zeile;
 *   - nichts in einer Kachel ragt über ihren Rand;
 *   - Kachelüberschriften der Kennzahlen brechen nicht im Wort;
 *   - die untere Leiste zeigt ganze Beschriftungen oder nur Symbole, nie „Sam…“;
 *   - ab etwa 360 px Breite zwei Spalten, darunter eine.
 *
 * Gegenproben (02.11.2026 gemessen, je einzeln):
 *   A  .sgrid in mobile.css wieder minmax(150px, 1fr) → rot: „390 px, 200 %“
 *      (ragt über die Kachel: Markt-Zeile, Datum)
 *   B  white-space:nowrap an .snum entfernt, zusammen mit A (allein bricht
 *      in einer Spalte nichts) → rot: „390 px, 200 %“ (Set-Nummer auf zwei
 *      Zeilen, zusätzlich zu den Funden von A)
 *   C  @container leiste wirkungslos (max-width: 1px) → rot: „390 px, 200 %“
 *      und „320 px, 200 %“ (Leiste: Beschriftung abgeschnitten)
 *   D  .bstat-l wieder overflow-wrap:anywhere und .brick-stats wieder
 *      repeat(2, minmax(0, 1fr)) → rot: „390 px, 200 %“ und „320 px, 200 %“
 *      (Wort gebrochen: „Minifiguren“, „Anleitungen“)
 *   E  mobile.css .btn wieder font-size:16px → rot: „390 px, 200 %“ und
 *      „320 px, 200 %“ (Knopfschrift wächst nicht mit)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp, warte } = require('./helpers/app-browser');
const { musterSammlung } = require('./helpers/bestand');

const MESSUNG = `(() => {
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
    const woerter = l.textContent.trim().split(/\\s+/).length;
    if (l.getBoundingClientRect().height > zeile(l) * woerter + 1) funde.push('Wort gebrochen: ' + name(l));
  }
  for (const t of document.querySelectorAll('nav .ntab')) {
    if (!t.checkVisibility()) continue;
    const l = t.querySelector('.tab-label');
    const versteckt = l.getBoundingClientRect().width <= 1;
    if (!versteckt && l.scrollWidth > l.clientWidth + 1) funde.push('Leiste: „' + l.textContent.trim() + '“ abgeschnitten');
    if (versteckt && !l.textContent.trim()) funde.push('Leiste: Symbol ohne Namen');
  }
  const knopf = document.querySelector('#tab-gallery .erfassen-leiste .btn.bp');
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  if (knopf && parseFloat(getComputedStyle(knopf).fontSize) < rem * 0.8) funde.push('Knopfschrift ' + getComputedStyle(knopf).fontSize + ' bei ' + rem + ' px Grundschrift');
  const spalten = getComputedStyle(document.querySelector('#gallery .sgrid')).gridTemplateColumns.split(' ').length;
  return { funde, spalten, rem };
})()`;

test('grosse Schrift und schmale Geräte: Sammlung lesbar', { timeout: 180_000 }, async (t) => {
  const app = await starteApp(t, { name: `gross_${process.pid}`, bestand: musterSammlung });
  if (app.grund) { t.skip(app.grund); return; }
  const { b } = app;
  await warte(1000);
  await b.auswerten(`document.querySelector('#einrichtung-modal.open [data-click="einrichtungSpaeter"]')?.click(); true`);
  await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
  await app.bis(`document.querySelectorAll('#gallery .sc').length >= 4`, 'Kacheln');
  const fall = async (breite, schrift) => {
    await b.tab('Emulation.setDeviceMetricsOverride', { width: breite, height: 844, deviceScaleFactor: 1, mobile: true });
    await b.tab('Page.setFontSizes', { fontSizes: { standard: schrift, fixed: Math.round(schrift * 0.8) } });
    await warte(400);
    return b.auswerten(MESSUNG);
  };
  for (const [breite, schrift, spalten] of [[390, 16, 2], [320, 16, 1], [390, 32, 1], [320, 32, 1]]) {
    await t.test(`${breite} px, ${schrift === 32 ? '200' : '100'} %`, async () => {
      const m = await fall(breite, schrift);
      assert.equal(m.rem, schrift, 'Grundschrift nicht übernommen');
      assert.deepEqual(m.funde, []);
      assert.equal(m.spalten, spalten, 'Spalten im Raster');
    });
  }
});
