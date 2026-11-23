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
  const leiste = document.querySelector('nav').getBoundingClientRect();
  const ueberlapp = [...document.querySelectorAll('#gallery .price-badge:not([hidden])')].flatMap(b => {
    // Die Textfläche, nicht die Box: Überlaufender Text ragt über seine Box hinaus.
    const flaeche = (e) => { if (!e) return null; const r = document.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect(); };
    const preis = flaeche(b.querySelector('.price'));
    const neighbor = flaeche(b.querySelector('.price-pnl, .pnl-gift, .pnl-pos, .pnl-neg'));
    if (!preis || !neighbor) return [];
    const quer = preis.right > neighbor.left + 0.5 && preis.left < neighbor.right && preis.bottom > neighbor.top + 0.5 && preis.top < neighbor.bottom;
    return quer ? [b.textContent.trim()] : [];
  });
  return { oben: k ? Math.round(k.top) : null, leiste: Math.round(leiste.top),
           karten: document.querySelectorAll('#gallery .price-badge:not([hidden])').length, ueberlapp,
           breit: document.documentElement.scrollWidth };
})()`;

test('collection on the phone: card above the fold, prices without overlap', { timeout: 120_000 }, async t => {
  const app = await startApp(t, { name: `falz_${process.pid}`, holding: patternCollection, telefon: true });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  for (const [breite, hoehe] of [
    [320, 640],
    [360, 740],
    [390, 844],
  ]) {
    await app.b.tab('Emulation.setDeviceMetricsOverride', {
      width: breite,
      height: hoehe,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await app.ruhig();
    await app.bis(
      `document.querySelectorAll('#gallery .price-badge:not([hidden])').length > 0`,
      'Marktpreise auf den Karten',
    );
    const m = await app.b.auswerten(messen);
    assert.ok(
      m.oben !== null && m.oben + 60 < m.leiste,
      `${breite}: first card above the fold (top ${m.oben}, bar ${m.leiste})`,
    );
    assert.ok(m.karten >= 2, `${breite}: too few price rows checked (${m.karten})`);
    assert.deepEqual(m.ueberlapp, [], `${breite}: price and neighbour overlap`);
    assert.equal(m.breit, breite, `${breite}: waagrechtes Scrollen`);
  }
});
