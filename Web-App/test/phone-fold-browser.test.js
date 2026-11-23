/**
 * Phone: in the collection, from 320 × 640 on the first set card lies above the
 * fold, and on the card the price never runs into „Geschenk“ or the profit.
 * Measured in Chrome on the real app with the sample collection.
 *
 * Counter-checks (measured 04.11.2026, each on its own):
 *   A  the phone block „Sammlung am Telefon“ removed in mobile.css → red:
 *      „320: erste Karte über der Falz“ (top 573, bar 583)
 *   B  the three rules on #gallery .price-badge again as a grid minmax(0,1fr) auto → red:
 *      „390: Preis und Nachbar überlappen“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');
const { patternCollection } = require('./helpers/inventory');

const messen = `(() => {
  const k = document.querySelector('#gallery .sc')?.getBoundingClientRect();
  const bar = document.querySelector('nav').getBoundingClientRect();
  const ueberlapp = [...document.querySelectorAll('#gallery .price-badge:not([hidden])')].flatMap(b => {
    // Die Textfläche, nicht die Box: Überlaufender Text ragt über seine Box hinaus.
    const flaeche = (e) => { if (!e) return null; const r = document.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect(); };
    const price = flaeche(b.querySelector('.price'));
    const neighbor = flaeche(b.querySelector('.price-pnl, .pnl-gift, .pnl-pos, .pnl-neg'));
    if (!price || !neighbor) return [];
    const landscape = price.right > neighbor.left + 0.5 && price.left < neighbor.right && price.bottom > neighbor.top + 0.5 && price.top < neighbor.bottom;
    return landscape ? [b.textContent.trim()] : [];
  });
  return { upper: k ? Math.round(k.top) : null, bar: Math.round(bar.top),
           karten: document.querySelectorAll('#gallery .price-badge:not([hidden])').length, ueberlapp,
           breit: document.documentElement.scrollWidth };
})()`;

test('collection on the phone: card above the fold, prices without overlap', { timeout: 120_000 }, async t => {
  const app = await startApp(t, { name: `falz_${process.pid}`, holding: patternCollection, phone: true });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  for (const [width, height] of [
    [320, 640],
    [360, 740],
    [390, 844],
  ]) {
    await app.b.tab('Emulation.setDeviceMetricsOverride', {
      width: width,
      height: height,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await app.settle();
    await app.until(
      `document.querySelectorAll('#gallery .price-badge:not([hidden])').length > 0`,
      'Marktpreise auf den Karten',
    );
    const m = await app.b.evaluate(messen);
    assert.ok(
      m.upper !== null && m.upper + 60 < m.bar,
      `${width}: first card above the fold (top ${m.upper}, bar ${m.bar})`,
    );
    assert.ok(m.karten >= 2, `${width}: too few price rows checked (${m.karten})`);
    assert.deepEqual(m.ueberlapp, [], `${width}: price and neighbour overlap`);
    assert.equal(m.breit, width, `${width}: waagrechtes Scrollen`);
  }
});
