/**
 * Die App am Telefon (390 × 844, mobile) — gemessen in Chrome am echten
 * Server mit den echten Stylesheets.
 *
 *   - Diagramme: Jede Beschriftung im Wertdiagramm (Finanzen) und im
 *     Preisverlauf (Set-Ansicht) ist mindestens 11 px groß, und jedes
 *     Diagramm hat role="img" mit einer Zusammenfassung als aria-label.
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  diagrammBreite() liefert immer 700 → rot: „Diagrammschrift
 *      Finanzen“ (5,6 px) und „Diagrammschrift Set-Ansicht“ (6,2 px)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp, warte } = require('./helpers/app-browser');
const { haeltSet } = require('./helpers/bestand');

/** Kleinste Schrift in px über alle Beschriftungen der Diagramme unter `wurzel`. */
const DIAGRAMMSCHRIFT = (wurzel) => `(() => {
  const svgs = [...document.querySelectorAll(${JSON.stringify(wurzel)} + ' svg.diagramm')];
  return svgs.map(svg => {
    const massstab = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    const groessen = [...svg.querySelectorAll('text')].map(x => parseFloat(getComputedStyle(x).fontSize) * massstab);
    return { rolle: svg.getAttribute('role'), name: svg.getAttribute('aria-label') || '',
             kleinste: Math.min(...groessen), anzahl: groessen.length };
  });
})()`;

test('Telefon', { concurrency: 1, timeout: 240_000 }, async (t) => {
  const app = await starteApp(t, {
    name: `telefon_${process.pid}`, telefon: true,
    bestand: async (db, uid) => {
      await haeltSet(db, uid, '10300-1', 1, { preis: 199 });
      await db.run(`DELETE FROM price_history WHERE set_number = '10300-1'`);
      for (const [tage, preis] of [[90, 210], [60, 230], [30, 250], [1, 260]])
        await db.run(`INSERT INTO price_history (set_number, condition, currency_code, avg_price, qty_avg_price, recorded_at)
                      VALUES ('10300-1', 'N', 'EUR', $1, $1, NOW() - ($2 || ' days')::interval)`, [preis, String(tage)]);
    },
  });
  if (app.grund) { t.skip(app.grund); return; }
  const { b, bis } = app;
  const reiter = async (name) => { await b.auswerten(`document.querySelector('.ntab[data-tab="${name}"]').click(); true`); await warte(400); };

  await t.test('Diagrammschrift Finanzen', async () => {
    await reiter('finance');
    await bis(`!!document.querySelector('#portfolio-chart svg.diagramm')`, 'Wertdiagramm');
    const [d] = await b.auswerten(DIAGRAMMSCHRIFT('#portfolio-chart'));
    assert.ok(d.anzahl >= 4, `nur ${d.anzahl} Beschriftungen`);
    assert.ok(d.kleinste >= 11, `kleinste Beschriftung ${d.kleinste.toFixed(1)} px`);
    assert.equal(d.rolle, 'img');
    assert.match(d.name, /Wertentwicklung Portfolio, .+ bis .+: von .+ auf .+/);
  });

  await t.test('Diagrammschrift Set-Ansicht', async () => {
    await reiter('gallery');
    await bis(`!!document.querySelector('[data-click="openModal"]')`, 'Set-Karte');
    await b.auswerten(`document.querySelector('[data-click="openModal"]').click(); true`);
    await bis(`!!document.querySelector('#m-sparkline-content svg.diagramm')`, 'Preisverlauf');
    const [d] = await b.auswerten(DIAGRAMMSCHRIFT('#m-sparkline-content'));
    assert.ok(d.kleinste >= 11, `kleinste Beschriftung ${d.kleinste.toFixed(1)} px`);
    assert.equal(d.rolle, 'img');
    assert.match(d.name, /Preisverlauf, .+ bis .+: Neu zuletzt/);
    await b.auswerten(`document.querySelector('#modal .mc-close, #modal [data-click="closeModal"]')?.click(); true`);
  });
});
