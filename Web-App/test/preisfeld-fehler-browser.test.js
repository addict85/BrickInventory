/**
 * Fehlermeldung am Preisfeld mit Währungswahl (Dialog „Set hinzufügen“), gemessen in Chrome bei 390 und
 * 1280 px: Das Preisfeld behält seine Breite, die Meldung steht unter der ganzen Zeile.
 *
 * Gegenprobe (08.11.2026 gemessen): in feldFehler (01-formular.js) die Meldung wieder direkt hinter das
 * Eingabefeld statt hinter den Wrapper `.preis-mit-waehrung` gesetzt
 *   → rot in beiden Breiten: Preisfeld nur noch ~25 px breit, Meldung neben der Währung.
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp } = require('./helpers/app-browser');

const MESSEN = `(() => { const r = id => document.getElementById(id).getBoundingClientRect();
  const m = document.getElementById('add-price-fehler'), zeile = document.querySelector('#add-set-modal .preis-mit-waehrung').getBoundingClientRect();
  const p = r('add-price'), w = r('add-currency'), f = m.getBoundingClientRect();
  return { sichtbar: !m.hidden && f.height > 0, text: m.textContent, preisBreite: Math.round(p.width), zeileBreite: Math.round(zeile.width),
           untenDrunter: f.top >= Math.max(p.bottom, w.bottom) - 1, meldungBreite: Math.round(f.width),
           nebeneinander: Math.abs(p.top - w.top) < 2 }; })()`;

test('Preisfeld: Fehlermeldung unter der ganzen Zeile', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await starteApp(t, { name: `preisfehler_${process.pid}`, telefon: true });
  if (app.grund) {
    t.skip(app.grund);
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
    await t.test(`${breite} px: Meldung unter der Zeile, Preisfeld behält Breite`, async () => {
      await b.tab('Emulation.setDeviceMetricsOverride', {
        width: breite,
        height: 900,
        deviceScaleFactor: 1,
        mobile: mobil,
      });
      await bis(`innerWidth === ${breite}`, 'Fenstergrösse');
      await b.auswerten(`document.querySelector('button[data-click="oeffneErfassen"][data-arg="set"]').click(); true`);
      await bis(`document.getElementById('add-set-modal').classList.contains('open')`, 'Dialog offen');
      await b.auswerten(`(() => { document.getElementById('add-num').value = '75192-1';
        document.getElementById('add-price').value = '12,x'; document.getElementById('btn-add').click(); return true; })()`);
      await bis(`!document.getElementById('add-price-fehler')?.hidden`, 'Meldung am Preisfeld');
      const m = await b.auswerten(MESSEN);
      await b.auswerten(`document.querySelector('#add-set-modal [data-click="schliesseErfassen"]').click(); true`);
      assert.equal(m.sichtbar, true, 'Meldung nicht sichtbar');
      assert.match(m.text, /12,x/);
      assert.equal(m.nebeneinander, true, 'Währung steht nicht mehr neben dem Preis');
      assert.ok(m.preisBreite >= 80, `Preisfeld nur ${m.preisBreite} px breit`);
      assert.equal(m.untenDrunter, true, 'Meldung steht nicht unter Preis und Währung');
      assert.ok(m.meldungBreite >= m.zeileBreite - 2, `Meldung ${m.meldungBreite} px, Zeile ${m.zeileBreite} px`);
    });
  }
});
