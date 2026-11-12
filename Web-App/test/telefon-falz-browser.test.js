/**
 * Telefon: In der Sammlung liegt ab 320 × 640 die erste Set-Karte über der
 * Falz, und auf der Karte läuft der Preis nie in „Geschenk“ oder den Gewinn.
 * Gemessen in Chrome an der echten App mit der Mustersammlung.
 *
 * Gegenproben (04.11.2026 gemessen, je einzeln):
 *   A  den Telefonblock „Sammlung am Telefon“ in mobile.css entfernt → rot:
 *      „320: erste Karte über der Falz“ (oben 573, Leiste 583)
 *   B  die drei Regeln zu #gallery .price-badge wieder als Raster minmax(0,1fr) auto → rot:
 *      „390: Preis und Nachbar überlappen“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp } = require('./helpers/app-browser');
const { musterSammlung } = require('./helpers/bestand');

const messen = `(() => {
  const k = document.querySelector('#gallery .sc')?.getBoundingClientRect();
  const leiste = document.querySelector('nav').getBoundingClientRect();
  const ueberlapp = [...document.querySelectorAll('#gallery .price-badge:not([hidden])')].flatMap(b => {
    // Die Textfläche, nicht die Box: Überlaufender Text ragt über seine Box hinaus.
    const flaeche = (e) => { if (!e) return null; const r = document.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect(); };
    const preis = flaeche(b.querySelector('.preis'));
    const nachbar = flaeche(b.querySelector('.preis-pnl, .pnl-geschenk, .pnl-pos, .pnl-neg'));
    if (!preis || !nachbar) return [];
    const quer = preis.right > nachbar.left + 0.5 && preis.left < nachbar.right && preis.bottom > nachbar.top + 0.5 && preis.top < nachbar.bottom;
    return quer ? [b.textContent.trim()] : [];
  });
  return { oben: k ? Math.round(k.top) : null, leiste: Math.round(leiste.top),
           karten: document.querySelectorAll('#gallery .price-badge:not([hidden])').length, ueberlapp,
           breit: document.documentElement.scrollWidth };
})()`;

test('Sammlung am Telefon: Karte über der Falz, Preise ohne Überlappung', { timeout: 120_000 }, async t => {
  const app = await starteApp(t, { name: `falz_${process.pid}`, bestand: musterSammlung, telefon: true });
  if (app.grund) {
    t.skip(app.grund);
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
      `${breite}: erste Karte über der Falz (oben ${m.oben}, Leiste ${m.leiste})`,
    );
    assert.ok(m.karten >= 2, `${breite}: zu wenig Preiszeilen geprüft (${m.karten})`);
    assert.deepEqual(m.ueberlapp, [], `${breite}: Preis und Nachbar überlappen`);
    assert.equal(m.breit, breite, `${breite}: waagrechtes Scrollen`);
  }
});
